"""Écriture des vidéos (avec audio) et post-traitement sans modèle, via ffmpeg."""

from __future__ import annotations

import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np


def ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def write_video(frames: np.ndarray, path: str | Path, fps: float, audio: np.ndarray | None = None, audio_rate: int = 24000, crf: int = 16) -> Path:
    """`frames` : (N, H, W, 3) uint8. `audio` : (C, S) ou (S,) float dans [-1, 1]."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    n, h, w, _ = frames.shape
    with tempfile.TemporaryDirectory() as tmp:
        cmd = [ffmpeg_exe(), "-y", "-loglevel", "error",
               "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", f"{fps}", "-i", "pipe:0"]
        if audio is not None and audio.size:
            wav = Path(tmp, "audio.wav")
            _write_wav(wav, audio, audio_rate)
            cmd += ["-i", str(wav), "-c:a", "aac", "-b:a", "192k", "-shortest"]
        cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", str(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(path)]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        _, err = proc.communicate(np.ascontiguousarray(frames).tobytes())
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg : {err.decode(errors='replace').strip()}")
    return path


def write_image(frame: np.ndarray, path: str | Path) -> Path:
    """`frame` : (H, W, 3) uint8 → PNG."""
    from PIL import Image

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.ascontiguousarray(frame)).save(path, optimize=True)
    return path


def upscale_image(src: str | Path, dst: str | Path, factor: float) -> Path:
    from PIL import Image

    im = Image.open(src)
    im = im.resize((round(im.width * factor), round(im.height * factor)), Image.LANCZOS)
    im.save(dst)
    return Path(dst)


def _write_wav(path: Path, audio: np.ndarray, rate: int) -> None:
    a = np.asarray(audio, dtype=np.float32)
    if a.ndim == 1:
        a = a[None, :]
    if a.shape[0] > a.shape[1]:  # (S, C) → (C, S)
        a = a.T
    pcm = (np.clip(a, -1, 1) * 32767).astype("<i2").T  # (S, C) entrelacé
    with wave.open(str(path), "wb") as f:
        f.setnchannels(pcm.shape[1])
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(pcm.tobytes())


def probe_video(path: str | Path) -> dict:
    """{"fps", "width", "height", "seconds", "audio"} lus dans la sortie d'ffmpeg (pas besoin d'ffprobe)."""
    import re

    r = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(path)], capture_output=True, text=True, errors="replace")
    info: dict = {"fps": 0.0, "width": 0, "height": 0, "seconds": 0.0, "audio": False}
    for line in r.stderr.splitlines():
        if "Video:" in line:
            m = re.search(r" (\d{2,5})x(\d{2,5})[ ,]", line)
            if m:
                info["width"], info["height"] = int(m.group(1)), int(m.group(2))
            m = re.search(r"([\d.]+) fps", line)
            if m:
                info["fps"] = float(m.group(1))
        elif "Audio:" in line:
            info["audio"] = True
        elif "Duration:" in line:
            m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", line)
            if m:
                info["seconds"] = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    return info


def post_process(src: str | Path, dst: str | Path, fps_out: float | None = None, upscale: float | None = None, crf: int = 16) -> Path:
    """Interpolation d'images (ffmpeg minterpolate) et/ou upscale (lanczos).

    Sans modèle : qualité honnête, zéro téléchargement. Un RIFE ou un
    upscaler neuronal pourront remplacer ces filtres plus tard.
    """
    src, dst = Path(src), Path(dst)
    filters = []
    if upscale and upscale != 1:
        filters.append(f"scale=iw*{upscale}:ih*{upscale}:flags=lanczos")
    if fps_out:
        filters.append(f"minterpolate=fps={fps_out}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1")
    if not filters:
        if src != dst:
            dst.write_bytes(src.read_bytes())
        return dst
    cmd = [ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(src), "-vf", ",".join(filters),
           "-c:v", "libx264", "-preset", "medium", "-crf", str(crf), "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", str(dst)]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg : {r.stderr.decode(errors='replace').strip()}")
    return dst


def load_image(path: str | Path, width: int, height: int) -> np.ndarray:
    """Image d'entrée recadrée (sans déformation) à la taille demandée, uint8 (H, W, 3)."""
    from PIL import Image, ImageOps

    im = Image.open(path)
    im = ImageOps.exif_transpose(im).convert("RGB")
    im = ImageOps.fit(im, (width, height), method=Image.LANCZOS)
    return np.asarray(im)
