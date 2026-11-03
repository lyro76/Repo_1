"""Backend ComfyUI : un workflow (format API) exécuté par le serveur ComfyUI."""

from __future__ import annotations

import time
import uuid
from pathlib import Path

from ..comfy.server import ComfyServer, kind_of_outputs, outputs_of
from ..comfy.workflow import analyze, fill, load_workflow
from ..protocol import Emitter, Job, Timings
from . import Backend, Cancelled, Result, Stage


class ComfyBackend(Backend):
    name = "comfy"

    def __init__(self, model_path: str, machine, server: ComfyServer):
        super().__init__(model_path, machine)
        self.server = server
        self.wf = load_workflow(model_path)
        self.analysis = analyze(self.wf)

    def warm(self, em: Emitter) -> None:
        self.server.start(log=em.log)
        self.loaded_key = "comfy"

    def generate(self, job: Job, em: Emitter, cancel) -> Result:
        t = Timings()
        with Stage(em, "load", t, model=Path(self.model_path).name, strategy="comfyui"):
            self.server.start(log=em.log)
            missing = self.server.missing_nodes(set(self.analysis.class_types))
            if missing:
                raise RuntimeError(f"nœuds absents de ton ComfyUI : {', '.join(missing)} (à installer via le gestionnaire de nœuds)")
        values: dict = {
            "prompt": job.prompt or None,
            "negative_prompt": job.negative_prompt or None,
            "seed": job.seed if job.seed is not None else None,
            "steps": job.steps,
            "guidance": job.guidance,
            "strength": job.strength if job.task.startswith("i") and job.task != "i2v" else None,
        }
        if job.width and job.height:
            values["width"], values["height"] = job.width, job.height
        if job.is_video:
            values["num_frames"] = job.num_frames
            values["fps"] = job.fps
            values["fps_out"] = job.fps
            values["seconds"] = job.seconds
        if job.task.endswith("2a"):
            values["seconds"] = job.seconds
        with Stage(em, "encode", t):
            if self.analysis.needs_image:
                values["image"] = self.server.upload_image(Path(job.image))
            wf = fill(self.wf, self.analysis, values)
        client_id = uuid.uuid4().hex
        state = {"max": 0, "value": 0, "t": time.perf_counter(), "steps": []}

        def on_progress(kind, value, maximum, node):
            if kind == "progress" and maximum:
                now = time.perf_counter()
                if value > state["value"]:
                    state["steps"].append((now - state["t"]) / max(1, value - state["value"]))
                state["value"], state["max"], state["t"] = value, maximum, now
                em.progress(value, maximum, state["steps"][-1] if state["steps"] else 0.0)

        with Stage(em, "sample", t, steps=job.steps or "workflow"):
            prompt_id = self.server.submit(wf, client_id)
            try:
                history = self.server.wait(prompt_id, client_id, on_progress, cancel)
            except InterruptedError:
                raise Cancelled() from None
            if state["steps"]:
                t.seconds_per_step = round(sum(state["steps"]) / len(state["steps"]), 3)
        items = outputs_of(history)
        if not items:
            raise RuntimeError("le workflow n'a produit aucun fichier (pas de nœud de sauvegarde ?)")
        kind = self.analysis.kind if self.analysis.kind in ("3d", "audio") else kind_of_outputs(items)
        files: list[Path] = []
        with Stage(em, "write", t):
            tmp = Path(job.out_dir) / ".comfy"
            for i, (_, it) in enumerate(items):
                files.append(self.server.download(it, tmp / f"{uuid.uuid4().hex[:8]}_{it['filename']}"))
        return Result(frames=None, fps=job.fps, kind=kind, files=files, timings=t, memory_plan={"strategy": "comfyui", "label": "géré par ComfyUI"},
                      settings={"steps": job.steps, "guidance": job.guidance, "seed": job.seed or 0, "workflow": Path(self.model_path).name})

    def unload(self) -> None:
        # Le serveur ComfyUI garde ses modèles en mémoire : on lui demande de libérer.
        try:
            self.server.post("/free", {"unload_models": True, "free_memory": True})
        except Exception:
            pass
        self.loaded_key = None
