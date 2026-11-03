"""Stable Diffusion XL / 1.5 : prompt → image et image → image.

Dossiers diffusers ou fichiers uniques (.safetensors). Les modèles distillés
(Turbo, Lightning) tournent en 4 étapes sans guidage ; les autres en 25-30.
Un SDXL en fp16 (~7 Go) tient sur 10 Go de VRAM ; en dessous, composant par
composant.
"""

from __future__ import annotations

import numpy as np

from .. import memory
from ..protocol import Emitter, Job, Timings
from ..video import load_image
from . import Backend, Result, Stage, crop_center, fit_dims
from . import torch_common as tc


class SdBackend(Backend):
    name = "sd"

    def __init__(self, model_path, machine):
        super().__init__(model_path, machine)
        self.pipe = None
        self.img2img = None
        low = model_path.lower()
        self.lightning = "lightning" in low
        self.turbo = "turbo" in low
        self.distilled = self.lightning or self.turbo or "lcm" in low

    def defaults(self, job: Job) -> tuple[int, float]:
        if self.distilled:
            return job.steps or 4, job.guidance if job.guidance is not None else 0.0
        return job.steps or 28, job.guidance if job.guidance is not None else 5.0

    def warm(self, em: Emitter) -> None:
        job = Job(model="", prompt="", task="t2i", width=1024, height=1024)
        self.load(self._plan(job, 28), job, em, Timings())

    def _plan(self, job: Job, steps: int) -> memory.Plan:
        return memory.plan(job.memory, self._size_gb(), self.machine.vram_mb, self.machine.ram_free_mb, job.width, job.height, steps)

    def load(self, plan: memory.Plan, job: Job, em: Emitter, t: Timings) -> None:
        key = f"{plan.strategy}|{job.sage}|{job.compile}"
        if self.pipe is not None and self.loaded_key == key:
            return
        self.unload()
        import torch
        from pathlib import Path

        from diffusers import AutoPipelineForImage2Image, AutoPipelineForText2Image, EulerDiscreteScheduler, StableDiffusionPipeline, StableDiffusionXLPipeline

        with Stage(em, "load", t, model=self.model_path, strategy=plan.strategy):
            dtype = torch.float16
            if Path(self.model_path).is_file():
                cls = StableDiffusionXLPipeline if "sdxl" in self._family() else StableDiffusionPipeline
                self.pipe = cls.from_single_file(self.model_path, torch_dtype=dtype, use_safetensors=self.model_path.endswith(".safetensors"))
            else:
                self.pipe = AutoPipelineForText2Image.from_pretrained(self.model_path, torch_dtype=dtype)
            if self.lightning:
                # SDXL Lightning est entraîné avec un espacement « trailing ».
                self.pipe.scheduler = EulerDiscreteScheduler.from_config(self.pipe.scheduler.config, timestep_spacing="trailing")
            self.pipe.set_progress_bar_config(disable=True)
            # Le pipeline image→image partage tous les poids.
            self.img2img = AutoPipelineForImage2Image.from_pipe(self.pipe)
            self.img2img.set_progress_bar_config(disable=True)
            # Pas de streaming de blocs pour un modèle qui tient (ou presque) : trop petit pour y gagner.
            if plan.strategy == "group_offload":
                plan = memory.Plan("cpu_offload", plan.vae_tiling, plan.reason)
            tc.apply_plan(self.pipe, plan, transformer_attr="unet", em=em)
            self.attention = "sdpa"
            self.compiled = tc.maybe_compile(self.pipe, job.compile, em, transformer_attr="unet")
        self.loaded_key = key

    def _family(self) -> str:
        from ..models import safetensors_keys
        from pathlib import Path

        p = Path(self.model_path)
        if p.is_file():
            keys = safetensors_keys(p)
            if any(k.startswith("conditioner.embedders.1") for k in keys) or (not keys and p.stat().st_size > 5e9):
                return "sdxl"
            return "sd"
        return "sdxl" if "xl" in p.name.lower() else "sd"

    def generate(self, job: Job, em: Emitter, cancel) -> Result:
        import torch

        t = Timings()
        steps, guidance = self.defaults(job)
        plan = self._plan(job, steps)
        em.log(f"stratégie mémoire : {plan.strategy} — {plan.reason}")
        tc.reset_peaks()
        self.load(plan, job, em, t)

        with Stage(em, "encode", t):
            from PIL import Image

            # SD : multiples de 8 ; SDXL aime les multiples de 64 pour la qualité.
            mod = 64 if "sdxl" in self._family() else 8
            gw, gh = fit_dims(job.width, job.height, mod)
            image = Image.fromarray(load_image(job.image, gw, gh)) if job.task == "i2i" else None
            gen = torch.Generator(device="cpu").manual_seed(job.seed if job.seed is not None else 0)

        common = dict(prompt=job.prompt, negative_prompt=job.negative_prompt or None, num_inference_steps=steps, guidance_scale=guidance,
                      generator=gen, output_type="np", callback_on_step_end=tc.step_callback(em, cancel, steps, t))
        import time

        t0 = time.perf_counter()
        with Stage(em, "sample", t, steps=steps, guidance=guidance):
            if image is not None:
                out = self.img2img(image=image, strength=job.strength, **common).images[0]
            else:
                out = self.pipe(width=gw, height=gh, **common).images[0]
        total = time.perf_counter() - t0
        t.sample = round(t.seconds_per_step * steps, 3)
        t.decode = round(max(0.0, total - t.sample), 3)
        em.stage("decode", "end", seconds=t.decode)

        frame = (np.asarray(out) * 255).round().clip(0, 255).astype(np.uint8)
        frames = crop_center(frame[None], job.width, job.height)
        vram, ram = tc.peaks()
        return Result(frames=frames, fps=0, kind="image", timings=t, vram_peak_mb=vram, ram_peak_mb=ram, memory_plan=plan.to_dict(),
                      settings={"steps": steps, "guidance": guidance, "seed": job.seed or 0, "strength": job.strength if image is not None else None,
                                "attention": self.attention, "compiled": self.compiled})

    def _size_gb(self) -> float:
        from pathlib import Path

        from ..models import dir_size_gb

        p = Path(self.model_path)
        if p.is_file():
            # fp16 à l'exécution : un checkpoint fp32 pèse deux fois son poids réel en VRAM.
            gb = p.stat().st_size / 1e9
            return round(gb / 2 if gb > 9 else gb, 1)
        un = p / "unet"
        return dir_size_gb(un) + 2 if un.is_dir() else dir_size_gb(p)

    def unload(self) -> None:
        if self.pipe is not None:
            self.img2img = None
            tc.release(self.pipe)
            self.pipe = None
            self.loaded_key = None
