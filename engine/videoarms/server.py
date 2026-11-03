"""Boucle du moteur : lit des commandes JSON sur stdin, répond sur stdout.

Lancé par l'application : `python -m videoarms.server`. Une seule
génération à la fois ; `cancel` interrompt celle en cours.
"""

from __future__ import annotations

import json
import re
import sys
import threading
import time
import traceback
from pathlib import Path

from . import models as models_mod
from .backends import Cancelled, get_backend
from .protocol import Emitter, Job, job_from_dict
from .system import probe_machine
from .video import post_process, upscale_image, write_image, write_video


class Engine:
    def __init__(self, em: Emitter):
        self.em = em
        self.machine = probe_machine()
        self.models: list[models_mod.ModelInfo] = []
        self.backend = None
        self.backend_key: str | None = None
        self.loaded: models_mod.ModelInfo | None = None
        # auto : l'app charge et remplace les modèles selon les besoins ;
        # sinon l'utilisateur charge et décharge lui-même.
        self.auto_load = True
        self.cancel = threading.Event()

    # ---- commandes
    def probe(self, paths: list[str]) -> dict:
        self.machine = probe_machine()
        self.models = models_mod.scan(paths)
        return {"machine": self.machine.to_dict(), "models": [m.to_dict() for m in self.models]}

    def _select(self, info: models_mod.ModelInfo) -> None:
        """Prépare le backend de ce modèle ; décharge le précédent si la politique le permet."""
        key = f"{info.backend}:{info.path}"
        if self.backend is not None and self.backend_key == key:
            return
        if self.backend is not None:
            if not self.auto_load and self.loaded is not None:
                raise ValueError(f"« {self.loaded.name} » est chargé ; décharge-le d'abord (ou repasse en mode auto)")
            self.unload()
        self.backend = get_backend(info.backend, info.path, self.machine)
        self.backend_key = key
        self.loaded = info

    def load(self, model_id: str) -> dict:
        info = models_mod.find(self.models, model_id)
        if info is None:
            raise ValueError(f"modèle inconnu : {model_id}")
        if not info.supported:
            raise ValueError(f"{info.name} : {info.note}")
        if self.backend is not None and self.backend_key != f"{info.backend}:{info.path}":
            self.unload()
        self._select(info)
        self.backend.warm(self.em)
        return {"model": info.to_dict()}

    def generate(self, job: Job) -> dict:
        info = models_mod.find(self.models, job.model)
        if info is None:
            raise ValueError(f"modèle inconnu : {job.model} (lance d'abord probe)")
        if not info.supported:
            raise ValueError(f"{info.name} : {info.note}")
        if job.task not in info.tasks:
            raise ValueError(f"{info.name} ne sait pas faire « {job.task} »")
        if info.backend != "mock" and not self.machine.torch:
            raise ValueError("torch n'est pas installé dans l'environnement du moteur")
        if job.needs_image and not Path(job.image).is_file():
            raise ValueError(f"image introuvable : {job.image}")
        self._select(info)
        self.cancel.clear()
        t0 = time.perf_counter()
        res = self.backend.generate(job, self.em, self.cancel)
        self.em.emit("loaded", model=info.to_dict())

        out_dir = Path(job.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        stem = safe_name(job.name) or f"{time.strftime('%Y%m%d-%H%M%S')}_{info.family.lower().replace(' ', '')}_{job.task}"
        up = job.post.get("upscale")
        if res.kind == "image":
            path = out_dir / f"{stem}.png"
            with _stage(self.em, "write", res.timings):
                write_image(res.frames[0], path)
            final = path
            if up and up != 1:
                with _stage(self.em, "post", res.timings):
                    final = upscale_image(path, out_dir / f"{stem}_x{up}.png", float(up))
        else:
            path = out_dir / f"{stem}.mp4"
            with _stage(self.em, "write", res.timings):
                write_video(res.frames, path, res.fps, res.audio, res.audio_rate)
            final = path
            if job.post.get("fps") or up:
                with _stage(self.em, "post", res.timings):
                    final = post_process(path, out_dir / f"{stem}_final.mp4", fps_out=job.post.get("fps"), upscale=up)
        return {
            "kind": res.kind, "task": job.task,
            "path": str(final), "raw_path": str(path), "frames": int(res.frames.shape[0]), "fps": res.fps,
            "width": int(res.frames.shape[2]), "height": int(res.frames.shape[1]), "audio": res.audio is not None,
            "timings": {**res.timings.__dict__, "total": round(time.perf_counter() - t0, 3)},
            "vram_peak_mb": res.vram_peak_mb, "ram_peak_mb": res.ram_peak_mb,
            "memory": res.memory_plan, "settings": res.settings, "model": info.to_dict(),
        }

    def unload(self) -> None:
        if self.backend is not None:
            self.backend.unload()
            self.backend = None
            self.backend_key = None
            self.loaded = None


class _stage:
    def __init__(self, em, name, timings):
        self.em, self.name, self.timings = em, name, timings

    def __enter__(self):
        self.t0 = time.perf_counter()
        self.em.stage(self.name, "start")

    def __exit__(self, *exc):
        dt = round(time.perf_counter() - self.t0, 3)
        setattr(self.timings, self.name, dt)
        self.em.stage(self.name, "end", seconds=dt, ok=exc[0] is None)
        return False


def safe_name(name: str) -> str:
    return re.sub(r"[^\w.-]+", "_", name.strip())[:80]


def serve(stdin=None, stdout=None) -> None:
    stdin = stdin or sys.stdin
    em = Emitter(stdout)
    engine = Engine(em)
    em.emit("ready", version=__import__("videoarms").__version__, machine=engine.machine.to_dict())
    worker: threading.Thread | None = None

    def run(msg: dict) -> None:
        em.job_id = msg.get("id")
        try:
            cmd = msg.get("cmd")
            if cmd == "probe":
                em.emit("probe", **engine.probe(msg.get("paths", [])))
            elif cmd == "generate":
                em.emit("done", **engine.generate(job_from_dict(msg["job"])))
            elif cmd == "load":
                em.emit("loaded", **engine.load(msg["model"]))
            elif cmd == "unload":
                engine.unload()
                em.emit("unloaded")
            elif cmd == "policy":
                engine.auto_load = bool(msg.get("auto_load", True))
                em.emit("policy", auto_load=engine.auto_load)
            else:
                em.emit("error", message=f"commande inconnue : {cmd}")
        except Cancelled:
            em.emit("cancelled")
        except Exception as e:
            em.emit("error", message=f"{type(e).__name__}: {e}", trace=traceback.format_exc())
        finally:
            em.job_id = None

    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            em.emit("error", message=f"JSON invalide : {e}")
            continue
        cmd = msg.get("cmd")
        if cmd == "cancel":
            engine.cancel.set()
            continue
        if cmd == "quit":
            engine.cancel.set()
            break
        if worker is not None and worker.is_alive():
            em.emit("error", id=msg.get("id"), message="le moteur est occupé")
            continue
        worker = threading.Thread(target=run, args=(msg,), daemon=True)
        worker.start()
        if cmd != "generate":
            worker.join()
    if worker is not None:
        worker.join(timeout=5)


if __name__ == "__main__":
    serve()
