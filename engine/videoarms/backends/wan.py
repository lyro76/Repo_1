"""Wan 2.1 / 2.2 (format diffusers) : image → vidéo, sans audio.

Wan 2.2 TI2V-5B utilise le pipeline image→vidéo avec `expand_timesteps`
(déjà dans son model_index). Par défaut : 50 étapes, guidance 5 — ce n'est
pas un modèle distillé, c'est lent ; c'est le candidat « rendu final ».
"""

from __future__ import annotations

import numpy as np

from .. import memory
from ..protocol import Emitter, Job, Timings
from ..video import load_image
from . import Backend, Result, Stage, crop_center, fit_dims
from . import torch_common as tc


class WanBackend(Backend):
    name = "wan"

    def __init__(self, model_path, machine):
        super().__init__(model_path, machine)
        self.pipe = None

    def load(self, plan: memory.Plan, job: Job, em: Emitter, t: Timings) -> None:
        key = f"{plan.strategy}|{job.sage}|{job.compile}"
        if self.pipe is not None and self.loaded_key == key:
            return
        self.unload()
        import torch
        from diffusers import AutoencoderKLWan, WanImageToVideoPipeline

        with Stage(em, "load", t, model=self.model_path, strategy=plan.strategy):
            # Le VAE de Wan est plus stable en float32.
            vae = AutoencoderKLWan.from_pretrained(self.model_path, subfolder="vae", torch_dtype=torch.float32)
            self.pipe = WanImageToVideoPipeline.from_pretrained(self.model_path, vae=vae, torch_dtype=tc.pick_dtype())
            self.pipe.set_progress_bar_config(disable=True)
            tc.apply_plan(self.pipe, plan, em=em)
            self.attention = tc.apply_attention(self.pipe, job.sage, em)
            self.compiled = tc.maybe_compile(self.pipe, job.compile, em)
        self.loaded_key = key

    def generate(self, job: Job, em: Emitter, cancel) -> Result:
        import torch

        t = Timings()
        steps = job.steps or 50
        guidance = job.guidance if job.guidance is not None else 5.0
        plan = memory.plan(job.memory, self._size_gb(), self.machine.vram_mb, self.machine.ram_free_mb, job.width, job.height, steps)
        em.log(f"stratégie mémoire : {plan.strategy} — {plan.reason}")
        tc.reset_peaks()
        self.load(plan, job, em, t)
        pipe = self.pipe

        with Stage(em, "encode", t):
            from PIL import Image

            # Wan veut des multiples de (VAE × patch) ; on génère un peu plus grand et on recadre.
            mod = pipe.vae_scale_factor_spatial * pipe.transformer.config.patch_size[1]
            width, height = fit_dims(job.width, job.height, mod)
            image = Image.fromarray(load_image(job.image, width, height))
            gen = torch.Generator(device="cpu").manual_seed(job.seed if job.seed is not None else 0)

        # Wan : 4k+1 images.
        n = ((job.num_frames - 1) // 4) * 4 + 1
        import time

        t0 = time.perf_counter()
        with Stage(em, "sample", t, steps=steps, guidance=guidance):
            video = pipe(
                image=image, prompt=job.prompt, negative_prompt=job.negative_prompt,
                height=height, width=width, num_frames=n, num_inference_steps=steps, guidance_scale=guidance,
                generator=gen, output_type="np", callback_on_step_end=tc.step_callback(em, cancel, steps, t),
            ).frames[0]
        total = time.perf_counter() - t0
        t.sample = round(t.seconds_per_step * steps, 3)
        t.decode = round(max(0.0, total - t.sample), 3)
        em.stage("decode", "end", seconds=t.decode)

        frames = crop_center((np.asarray(video) * 255).round().clip(0, 255).astype(np.uint8), job.width, job.height)
        vram, ram = tc.peaks()
        return Result(frames=frames, fps=job.fps, timings=t, vram_peak_mb=vram, ram_peak_mb=ram, memory_plan=plan.to_dict(),
                      settings={"steps": steps, "guidance": guidance, "seed": job.seed or 0, "attention": self.attention, "compiled": self.compiled})

    def _size_gb(self) -> float:
        from pathlib import Path

        from ..models import dir_size_gb

        tr = Path(self.model_path, "transformer")
        return dir_size_gb(tr) if tr.is_dir() else dir_size_gb(Path(self.model_path))

    def unload(self) -> None:
        if self.pipe is not None:
            self.pipe = None
            self.loaded_key = None
            tc.reset_peaks()
