"""Moteur factice : une vraie vidéo ou image, sans modèle.

Sert à développer et tester l'application sans GPU : mêmes étapes, mêmes
événements, même format de sortie que les vrais backends.
- i2v / i2i : l'image d'entrée, animée (zoom + dérive) ou retouchée ;
- t2v / t2i : un dégradé dont les couleurs dépendent du prompt.
"""

from __future__ import annotations

import hashlib
import time

import numpy as np

from ..protocol import Emitter, Job, Timings
from ..video import load_image
from . import Backend, Cancelled, Result, Stage


def prompt_canvas(prompt: str, width: int, height: int) -> np.ndarray:
    h = hashlib.sha256(prompt.encode()).digest()
    a, b = np.array(list(h[:3]), dtype=np.float32), np.array(list(h[3:6]), dtype=np.float32)
    ys, xs = np.mgrid[0:height, 0:width]
    t = (xs / max(1, width - 1) * 0.6 + ys / max(1, height - 1) * 0.4)[..., None]
    return (a * (1 - t) + b * t).astype(np.float32)


class MockBackend(Backend):
    name = "mock"

    def warm(self, em: Emitter) -> None:
        self.loaded_key = "mock"

    def generate(self, job: Job, em: Emitter, cancel) -> Result:
        t = Timings()
        steps = job.steps or (8 if job.is_video else 4)
        with Stage(em, "load", t, model="factice"):
            time.sleep(0.05)
        with Stage(em, "encode", t):
            if job.needs_image:
                base = load_image(job.image, job.width, job.height).astype(np.float32)
                if job.task == "i2i":
                    base = base * (1 - job.strength) + prompt_canvas(job.prompt, job.width, job.height) * job.strength
            else:
                base = prompt_canvas(job.prompt, job.width, job.height)
        n = job.num_frames if job.is_video else 1
        frames = np.empty((n, job.height, job.width, 3), dtype=np.uint8)
        with Stage(em, "sample", t, steps=steps):
            per = max(0.02, 0.3 * (job.width * job.height) / (1280 * 720) * n / 121)
            for s in range(steps):
                if cancel.is_set():
                    raise Cancelled()
                time.sleep(per)
                em.progress(s + 1, steps, per)
            t.seconds_per_step = round(per, 3)
        with Stage(em, "decode", t):
            h, w = job.height, job.width
            ys, xs = np.mgrid[0:h, 0:w]
            for i in range(n):
                if cancel.is_set():
                    raise Cancelled()
                k = i / max(1, n - 1)
                zoom = 1.0 + 0.08 * k
                dx, dy = 0.03 * w * k, 0.02 * h * k
                sx = np.clip(((xs - w / 2) / zoom + w / 2 + dx), 0, w - 1).astype(np.int32)
                sy = np.clip(((ys - h / 2) / zoom + h / 2 + dy), 0, h - 1).astype(np.int32)
                frames[i] = np.clip(base[sy, sx] * (0.9 + 0.1 * np.sin(k * 6.28)), 0, 255)
        audio = None
        if job.audio and job.is_video:
            rate = 24000
            tt = np.arange(int(job.seconds * rate)) / rate
            lum = base.mean() / 255
            tone = 0.2 * np.sin(2 * np.pi * (110 + 220 * lum) * tt) * np.exp(-tt / job.seconds)
            audio = np.stack([tone, tone]).astype(np.float32)
        self.loaded_key = "mock"
        return Result(frames=frames, fps=job.fps, kind="video" if job.is_video else "image", audio=audio, timings=t,
                      memory_plan={"strategy": "gpu", "label": "factice"}, settings={"steps": steps, "guidance": 1.0, "seed": job.seed or 0})
