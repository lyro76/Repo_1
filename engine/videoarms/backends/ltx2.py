"""LTX-2 / 2.3 (format diffusers) : image → vidéo avec audio.

Réglages par défaut :
- modèle distillé : 8 étapes, sans guidage (guidance 1, STG 0) ;
- modèle « dev » : 30 étapes, guidance 3.
"""

from __future__ import annotations

import numpy as np

from .. import memory
from ..protocol import Emitter, Job, Timings
from ..video import load_image
from . import Backend, Result, Stage, crop_center, fit_dims
from . import torch_common as tc


class Ltx2Backend(Backend):
    name = "ltx2"

    def __init__(self, model_path, machine):
        super().__init__(model_path, machine)
        self.pipe = None
        self.distilled = "distill" in model_path.lower()

    def defaults(self, job: Job) -> tuple[int, float]:
        steps = job.steps or (8 if self.distilled else 30)
        guidance = job.guidance if job.guidance is not None else (1.0 if self.distilled else 3.0)
        return steps, guidance

    def load(self, plan: memory.Plan, job: Job, em: Emitter, t: Timings) -> None:
        key = f"{plan.strategy}|{job.sage}|{job.compile}"
        if self.pipe is not None and self.loaded_key == key:
            return
        self.unload()
        import torch
        from diffusers import LTX2ImageToVideoPipeline

        with Stage(em, "load", t, model=self.model_path, strategy=plan.strategy):
            self.pipe = LTX2ImageToVideoPipeline.from_pretrained(self.model_path, torch_dtype=tc.pick_dtype())
            self.pipe.set_progress_bar_config(disable=True)
            tc.apply_plan(self.pipe, plan, em=em)
            self.attention = tc.apply_attention(self.pipe, job.sage, em)
            self.compiled = tc.maybe_compile(self.pipe, job.compile, em)
        self.loaded_key = key

    def generate(self, job: Job, em: Emitter, cancel) -> Result:
        import torch

        t = Timings()
        steps, guidance = self.defaults(job)
        size_gb = self._size_gb()
        plan = memory.plan(job.memory, size_gb, self.machine.vram_mb, self.machine.ram_free_mb, job.width, job.height, steps)
        em.log(f"stratégie mémoire : {plan.strategy} — {plan.reason}")
        tc.reset_peaks()
        self.load(plan, job, em, t)
        pipe = self.pipe

        with Stage(em, "encode", t):
            from PIL import Image

            # LTX-2 : multiples de 32 ; on génère un peu plus grand et on recadre.
            gw, gh = fit_dims(job.width, job.height, 32)
            image = Image.fromarray(load_image(job.image, gw, gh))
            gen = torch.Generator(device="cpu").manual_seed(job.seed if job.seed is not None else 0)

        n = job.num_frames
        kwargs = dict(
            image=image, prompt=job.prompt, negative_prompt=job.negative_prompt,
            width=gw, height=gh, num_frames=n, frame_rate=job.fps,
            num_inference_steps=steps, guidance_scale=guidance,
            stg_scale=0.0 if self.distilled else 1.0,
            generator=gen, output_type="np", return_dict=False,
            callback_on_step_end=tc.step_callback(em, cancel, steps, t),
        )
        if not job.audio:
            kwargs.update(audio_guidance_scale=None)
        # Sampling + décodage sont imbriqués dans le pipeline : on mesure le
        # sampling par les callbacks, le reste est attribué au décodage.
        import time

        t0 = time.perf_counter()
        with Stage(em, "sample", t, steps=steps, guidance=guidance):
            video, audio = pipe(**kwargs)
        total = time.perf_counter() - t0
        t.sample = round(t.seconds_per_step * steps, 3)
        t.decode = round(max(0.0, total - t.sample), 3)
        em.stage("decode", "end", seconds=t.decode)

        frames = crop_center((np.asarray(video[0]) * 255).round().clip(0, 255).astype(np.uint8), job.width, job.height)
        wav = None
        if job.audio and audio is not None:
            a = audio[0]
            wav = a.float().cpu().numpy() if hasattr(a, "cpu") else np.asarray(a, dtype=np.float32)
        vram, ram = tc.peaks()
        return Result(frames=frames, fps=job.fps, audio=wav, audio_rate=int(pipe.vocoder.config.output_sampling_rate),
                      timings=t, vram_peak_mb=vram, ram_peak_mb=ram, memory_plan=plan.to_dict(),
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
