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

import shutil

from . import models as models_mod
from .backends import Cancelled, get_backend
from .comfy.server import ComfyServer
from .comfy.workflow import analyze, load_workflow
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
        self.comfy = ComfyServer(None)
        self.workflows_dir: str | None = None
        # Une seule génération à la fois, d'où qu'elle vienne (interface ou API).
        self.lock = threading.RLock()
        self.api = None

    # ---- commandes
    def probe(self, paths: list[str], comfy: dict | None = None, workflows_dir: str | None = None) -> dict:
        self.machine = probe_machine()
        comfy = comfy or {}
        if comfy.get("dir") != (str(self.comfy.dir) if self.comfy.dir else None) or comfy.get("port", 8188) != self.comfy.port or (comfy.get("python") or None) != (str(self.comfy.python) if self.comfy.python and comfy.get("python") else None):
            if self.backend is not None and self.backend_key and self.backend_key.startswith("comfy:"):
                self.unload()
            self.comfy.stop()
            self.comfy = ComfyServer(comfy.get("dir"), comfy.get("python") or None, int(comfy.get("port", 8188)))
        self.workflows_dir = workflows_dir
        self.models = models_mod.scan(paths, workflows_dir=workflows_dir)
        return {"machine": self.machine.to_dict(), "models": [m.to_dict() for m in self.models], "comfy": self.comfy.status()}

    def import_workflow(self, path: str) -> dict:
        """Copie un workflow API dans le dossier des workflows et renvoie son analyse."""
        if not self.workflows_dir:
            raise ValueError("dossier des workflows non défini")
        src = Path(path)
        a = analyze(load_workflow(src))
        dest = Path(self.workflows_dir) / src.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.resolve() != dest.resolve():
            shutil.copyfile(src, dest)
        missing = self.comfy.missing_nodes(set(a.class_types)) if self.comfy.alive() else []
        info = models_mod.read_workflow(dest)
        if info and info.id not in {m.id for m in self.models}:
            self.models.insert(0, info)
        return {"model": info.to_dict() if info else None, "analysis": a.to_dict(), "missing": missing}

    def workflow_check(self, model_id: str) -> dict:
        info = models_mod.find(self.models, model_id)
        if info is None or info.backend != "comfy":
            raise ValueError("ce n'est pas un workflow ComfyUI")
        a = analyze(load_workflow(info.path))
        self.comfy.start(log=self.em.log)
        return {"model": info.to_dict(), "analysis": a.to_dict(), "missing": self.comfy.missing_nodes(set(a.class_types))}

    def _select(self, info: models_mod.ModelInfo) -> None:
        """Prépare le backend de ce modèle ; décharge le précédent si la politique le permet."""
        key = f"{info.backend}:{info.path}"
        if self.backend is not None and self.backend_key == key:
            return
        if self.backend is not None:
            if not self.auto_load and self.loaded is not None:
                raise ValueError(f"« {self.loaded.name} » est chargé ; décharge-le d'abord (ou repasse en mode auto)")
            self.unload()
        self.backend = get_backend(info.backend, info.path, self.machine, server=self.comfy, variants=info.variants or None)
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
        if info.backend in ("ltx2", "wan", "sd") and not self.machine.torch:
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
        if res.files:
            # Fichiers déjà produits (ComfyUI ou factice 3D/audio) : rangés sous un nom lisible.
            finals = []
            for i, f in enumerate(res.files):
                f = Path(f)
                dest = out_dir / f"{stem}{'' if i == 0 else f'_{i + 1}'}{f.suffix.lower()}"
                with _stage(self.em, "write", res.timings) if i == 0 else _nullctx():
                    shutil.move(str(f), dest)
                finals.append(dest)
            final, path = finals[0], finals[0]
            w = h = 0
            if res.kind == "image":
                try:
                    from PIL import Image

                    w, h = Image.open(final).size
                except Exception:
                    pass
            return {
                "kind": res.kind, "task": job.task, "path": str(final), "raw_path": str(path), "files": [str(f) for f in finals],
                "frames": 0, "fps": res.fps, "width": w, "height": h, "audio": res.kind == "audio",
                "timings": {**res.timings.__dict__, "total": round(time.perf_counter() - t0, 3)},
                "vram_peak_mb": res.vram_peak_mb, "ram_peak_mb": res.ram_peak_mb,
                "memory": res.memory_plan, "settings": res.settings, "model": info.to_dict(),
            }
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
            "path": str(final), "raw_path": str(path), "files": [str(final)], "frames": int(res.frames.shape[0]), "fps": res.fps,
            "width": int(res.frames.shape[2]), "height": int(res.frames.shape[1]), "audio": res.audio is not None,
            "timings": {**res.timings.__dict__, "total": round(time.perf_counter() - t0, 3)},
            "vram_peak_mb": res.vram_peak_mb, "ram_peak_mb": res.ram_peak_mb,
            "memory": res.memory_plan, "settings": res.settings, "model": info.to_dict(),
        }

    def set_api(self, enabled: bool, port: int = 8765, token: str | None = None, out_dir: str | None = None) -> dict:
        """Active ou coupe l'API HTTP locale (pilotage par une IA ou un script)."""
        from .api import ApiServer

        if self.api is not None:
            self.api.stop()
            self.api = None
        if enabled:
            self.api = ApiServer(self, "127.0.0.1", port, token or None)
            if out_dir:
                self.api.default_out_dir = out_dir
            self.api.start()
            return {"enabled": True, "url": self.api.url, "port": self.api.port, "token": bool(token)}
        return {"enabled": False}

    def unload(self) -> None:
        if self.backend is not None:
            self.backend.unload()
            self.backend = None
            self.backend_key = None
            self.loaded = None


class _nullctx:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


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
    # Sous Windows, la console est en cp1252 : nos événements sont en UTF-8.
    for stream in (sys.stdout, sys.stderr, sys.stdin):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    em = Emitter(stdout)
    engine = Engine(em)
    em.emit("ready", version=__import__("videoarms").__version__, machine=engine.machine.to_dict())
    worker: threading.Thread | None = None

    def run(msg: dict) -> None:
        em.job_id = msg.get("id")
        try:
            cmd = msg.get("cmd")
            if cmd == "probe":
                em.emit("probe", **engine.probe(msg.get("paths", []), msg.get("comfy"), msg.get("workflows_dir")))
            elif cmd == "comfy_start":
                engine.comfy.start(log=em.log)
                em.emit("comfy", **engine.comfy.status())
            elif cmd == "comfy_stop":
                if engine.backend is not None and (engine.backend_key or "").startswith("comfy:"):
                    engine.unload()
                engine.comfy.stop()
                em.emit("comfy", **engine.comfy.status())
            elif cmd == "comfy_status":
                em.emit("comfy", **engine.comfy.status())
            elif cmd == "workflow_import":
                em.emit("workflow", **engine.import_workflow(msg["path"]))
            elif cmd == "workflow_check":
                em.emit("workflow", **engine.workflow_check(msg["model"]))
            elif cmd == "generate":
                if not engine.lock.acquire(blocking=False):
                    em.log("une tâche lancée par l'API est en cours : la tienne attend son tour")
                    engine.lock.acquire()
                try:
                    em.emit("done", **engine.generate(job_from_dict(msg["job"])))
                finally:
                    engine.lock.release()
            elif cmd == "api":
                em.emit("api", **engine.set_api(bool(msg.get("enabled")), int(msg.get("port", 8765)), msg.get("token"), msg.get("out_dir")))
            elif cmd == "load":
                with engine.lock:
                    em.emit("loaded", **engine.load(msg["model"]))
            elif cmd == "unload":
                with engine.lock:
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
            if engine.api is not None:
                engine.api.stop()
            engine.comfy.stop()
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
