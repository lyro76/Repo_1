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

from pathlib import Path

from ..protocol import Emitter, Job, Timings
from ..video import load_image, write_audio
from . import Backend, Cancelled, Result, Stage


def prompt_canvas(prompt: str, width: int, height: int) -> np.ndarray:
    h = hashlib.sha256(prompt.encode()).digest()
    a, b = np.array(list(h[:3]), dtype=np.float32), np.array(list(h[3:6]), dtype=np.float32)
    ys, xs = np.mgrid[0:height, 0:width]
    t = (xs / max(1, width - 1) * 0.6 + ys / max(1, height - 1) * 0.4)[..., None]
    return (a * (1 - t) + b * t).astype(np.float32)


def tiny_glb(path, color=(0.9, 0.6, 0.1)) -> None:
    """Un vrai fichier GLB (glTF binaire) : une pyramide colorée."""
    import json
    import struct

    v = np.array([[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [0, 1.6, 0]], dtype=np.float32)
    idx = np.array([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 2, 1, 0, 3, 2], dtype=np.uint16)
    vb, ib = v.tobytes(), idx.tobytes()
    ib += b"\0" * ((4 - len(ib) % 4) % 4)
    bin_chunk = vb + ib
    gltf = {
        "asset": {"version": "2.0", "generator": "ScreenComfy mock"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [*color, 1.0], "metallicFactor": 0.0}}],
        "buffers": [{"byteLength": len(bin_chunk)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(vb), "target": 34962},
                        {"buffer": 0, "byteOffset": len(vb), "byteLength": len(idx.tobytes()), "target": 34963}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 5, "type": "VEC3", "min": v.min(0).tolist(), "max": v.max(0).tolist()},
                      {"bufferView": 1, "componentType": 5123, "count": int(idx.size), "type": "SCALAR"}],
    }
    js = json.dumps(gltf).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    body = struct.pack("<II", 0x4E4F534A, len(js)) + js + struct.pack("<II", 0x004E4942, len(bin_chunk)) + bin_chunk
    Path(path).write_bytes(b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body)


class MockBackend(Backend):
    name = "mock"

    def warm(self, em: Emitter) -> None:
        self.loaded_key = "mock"

    def generate(self, job: Job, em: Emitter, cancel) -> Result:
        if job.task.endswith("3d") or job.task.endswith("2a"):
            return self.generate_file(job, em, cancel)
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

    def generate_file(self, job: Job, em: Emitter, cancel) -> Result:
        """3D (pyramide GLB teintée par l'image/le prompt) ou audio (accord qui dépend du prompt)."""
        t = Timings()
        steps = job.steps or 6
        with Stage(em, "load", t, model="factice"):
            time.sleep(0.05)
        with Stage(em, "encode", t):
            base = load_image(job.image, 64, 64).astype(np.float32) if job.needs_image else prompt_canvas(job.prompt, 64, 64)
            color = tuple((base.reshape(-1, 3).mean(0) / 255).round(3).tolist())
        with Stage(em, "sample", t, steps=steps):
            for s in range(steps):
                if cancel.is_set():
                    raise Cancelled()
                time.sleep(0.03)
                em.progress(s + 1, steps, 0.03)
            t.seconds_per_step = 0.03
        tmp = Path(job.out_dir) / ".mock"
        tmp.mkdir(parents=True, exist_ok=True)
        with Stage(em, "decode", t):
            if job.task.endswith("3d"):
                path = tmp / "maillage.glb"
                tiny_glb(path, color)
                kind = "3d"
            else:
                rate = 24000
                tt = np.arange(int(job.seconds * rate)) / rate
                root = 110 + 220 * color[0]
                wave = sum(0.15 * np.sin(2 * np.pi * root * r * tt) for r in (1, 1.25, 1.5)) * np.exp(-tt / job.seconds * 1.5)
                path = tmp / "son.mp3"
                write_audio(np.stack([wave, wave]).astype(np.float32), path, rate)
                kind = "audio"
        self.loaded_key = "mock"
        return Result(frames=None, fps=0, kind=kind, files=[path], timings=t, memory_plan={"strategy": "gpu", "label": "factice"},
                      settings={"steps": steps, "guidance": 1.0, "seed": job.seed or 0})
