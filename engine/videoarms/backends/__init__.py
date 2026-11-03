"""Un backend = une façon de transformer un Job en images (et son).

`Backend.generate` reçoit le Job et un Emitter, et renvoie un `Result`.
Les étapes et la progression sont signalées via l'Emitter pour que
l'interface affiche le profil (temps par étage, VRAM).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from ..protocol import Emitter, Job, Timings


@dataclass
class Result:
    frames: np.ndarray | None          # (N, H, W, 3) uint8 ; N = 1 pour une image ; None si `files`
    fps: float
    kind: str = "video"                # video | image | audio | 3d
    # Fichiers déjà produits (ComfyUI) : le premier est le résultat principal.
    files: list = field(default_factory=list)
    audio: np.ndarray | None = None    # (C, S) float32
    audio_rate: int = 24000
    timings: Timings = field(default_factory=Timings)
    vram_peak_mb: int = 0
    ram_peak_mb: int = 0
    memory_plan: dict = field(default_factory=dict)
    settings: dict = field(default_factory=dict)


class Stage:
    """`with Stage(emitter, 'sample', timings): …` signale début/fin et mesure."""

    def __init__(self, em: Emitter, name: str, timings: Timings, **detail):
        self.em, self.name, self.timings, self.detail = em, name, timings, detail

    def __enter__(self):
        self.t0 = time.perf_counter()
        self.em.stage(self.name, "start", **self.detail)
        return self

    def __exit__(self, exc_type, exc, tb):
        dt = time.perf_counter() - self.t0
        setattr(self.timings, self.name, round(dt, 3))
        self.em.stage(self.name, "end", seconds=round(dt, 3), ok=exc is None)
        return False


class Backend:
    name = "base"

    def __init__(self, model_path: str, machine):
        self.model_path = model_path
        self.machine = machine
        self.loaded_key: str | None = None

    def generate(self, job: Job, em: Emitter, cancel) -> Result:  # pragma: no cover - interface
        raise NotImplementedError

    def warm(self, em: Emitter) -> None:
        """Charge le modèle sans générer (bouton « Charger »)."""

    def unload(self) -> None:
        pass


class Cancelled(Exception):
    pass


def get_backend(kind: str, model_path: str, machine, server=None) -> Backend:
    if kind == "mock":
        from .mock import MockBackend

        return MockBackend(model_path, machine)
    if kind == "ltx2":
        from .ltx2 import Ltx2Backend

        return Ltx2Backend(model_path, machine)
    if kind == "wan":
        from .wan import WanBackend

        return WanBackend(model_path, machine)
    if kind == "sd":
        from .sd import SdBackend

        return SdBackend(model_path, machine)
    if kind == "comfy":
        from .comfy_backend import ComfyBackend

        return ComfyBackend(model_path, machine, server)
    raise ValueError(f"backend inconnu : {kind}")


def fit_dims(width: int, height: int, mod: int) -> tuple[int, int]:
    """Plus petites dimensions ≥ demandées qui soient des multiples de `mod`."""
    r = lambda v: ((v + mod - 1) // mod) * mod
    return r(width), r(height)


def crop_center(frames: np.ndarray, width: int, height: int) -> np.ndarray:
    """Recadre (N, H, W, 3) au centre à (height, width) si la génération était plus grande."""
    n, h, w, _ = frames.shape
    if (w, h) == (width, height):
        return frames
    y0, x0 = max(0, (h - height) // 2), max(0, (w - width) // 2)
    return np.ascontiguousarray(frames[:, y0:y0 + height, x0:x0 + width])
