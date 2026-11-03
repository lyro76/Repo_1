"""Ce que la machine offre : GPU, mémoire, bibliothèques présentes."""

from __future__ import annotations

import importlib
import shutil
import subprocess
from dataclasses import dataclass, field


@dataclass
class Machine:
    gpu: str | None = None
    vram_mb: int = 0
    driver: str | None = None
    ram_mb: int = 0
    ram_free_mb: int = 0
    torch: str | None = None
    cuda: bool = False
    diffusers: str | None = None
    sage: bool = False
    ffmpeg: bool = False
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def _version(mod: str) -> str | None:
    try:
        return getattr(importlib.import_module(mod), "__version__", "?")
    except Exception:
        return None


def nvidia_smi() -> tuple[str, int, str] | None:
    """(nom, VRAM en Mo, pilote) via nvidia-smi, présent avec le pilote NVIDIA."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        out = subprocess.run(
            [exe, "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        )
    except Exception:
        return None
    best = None
    for line in out.stdout.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 3 and parts[1].isdigit():
            g = (parts[0], int(parts[1]), parts[2])
            if best is None or g[1] > best[1]:
                best = g
    return best


def gpu_free_mb() -> int:
    """VRAM libre maintenant (nvidia-smi), 0 si inconnue."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return 0
    try:
        out = subprocess.run([exe, "--query-gpu=memory.free", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
        return max(int(l.strip()) for l in out.stdout.splitlines() if l.strip().isdigit())
    except Exception:
        return 0


def probe_machine() -> Machine:
    m = Machine()
    try:
        import psutil

        vm = psutil.virtual_memory()
        m.ram_mb = vm.total // (1024 * 1024)
        m.ram_free_mb = vm.available // (1024 * 1024)
    except Exception:
        pass
    smi = nvidia_smi()
    if smi:
        m.gpu, m.vram_mb, m.driver = smi
    m.torch = _version("torch")
    if m.torch:
        try:
            import torch

            m.cuda = bool(torch.cuda.is_available())
            if m.cuda and not m.gpu:
                m.gpu = torch.cuda.get_device_name(0)
                m.vram_mb = torch.cuda.get_device_properties(0).total_memory // (1024 * 1024)
        except Exception as e:  # pragma: no cover
            m.notes.append(f"torch présent mais inutilisable : {e}")
    m.diffusers = _version("diffusers")
    m.sage = _version("sageattention") is not None
    try:
        import imageio_ffmpeg

        m.ffmpeg = bool(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        m.ffmpeg = bool(shutil.which("ffmpeg"))
    if not m.torch:
        m.notes.append("torch absent : seul le moteur factice est disponible")
    elif not m.cuda:
        m.notes.append("pas de GPU CUDA : les vrais modèles tourneraient sur le processeur (très lent)")
    return m
