"""Moteur factice : une vraie vidéo à partir de l'image d'entrée, sans modèle.

Sert à développer et tester l'application sans GPU : mêmes étapes, mêmes
événements, même format de sortie que les vrais backends. Le mouvement est
un lent zoom + dérive, l'audio un bourdon qui suit la luminosité.
"""

from __future__ import annotations

import time

import numpy as np

from ..protocol import Emitter, Job, Timings
from ..video import load_image
from . import Backend, Cancelled, Result, Stage


class MockBackend(Backend):
    name = "mock"

    def generate(self, job: Job, em: Emitter, cancel) -> Result:
        t = Timings()
        steps = job.steps or 8
        with Stage(em, "load", t, model="factice"):
            time.sleep(0.05)
        with Stage(em, "encode", t):
            base = load_image(job.image, job.width, job.height).astype(np.float32)
        n = job.num_frames
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
        if job.audio:
            rate = 24000
            tt = np.arange(int(job.seconds * rate)) / rate
            lum = base.mean() / 255
            tone = 0.2 * np.sin(2 * np.pi * (110 + 220 * lum) * tt) * np.exp(-tt / job.seconds)
            audio = np.stack([tone, tone]).astype(np.float32)
        return Result(frames=frames, fps=job.fps, audio=audio, timings=t, memory_plan={"strategy": "gpu", "label": "factice"},
                      settings={"steps": steps, "guidance": 1.0, "seed": job.seed or 0})
