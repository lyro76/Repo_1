"""Ce que l'app et le moteur s'échangent : une ligne JSON par message.

Entrée (stdin)  : {"id": 1, "cmd": "probe" | "generate" | "cancel" | "unload" | "quit", ...}
Sortie (stdout) : {"id": 1, "event": "...", ...}

Les événements d'une génération, dans l'ordre :
  stage (start/end, par étape)  →  progress (par pas de sampling)  →  done | error
Tout le reste (journal) passe sur stderr, jamais sur stdout.
"""

from __future__ import annotations

import json
import sys
import threading
from dataclasses import asdict, dataclass, field
from typing import Any

STAGES = ("load", "encode", "sample", "decode", "write", "post")

STAGE_LABELS = {
    "load": "chargement du modèle",
    "encode": "encodage texte et image",
    "sample": "génération (sampling)",
    "decode": "décodage VAE",
    "write": "écriture de la vidéo",
    "post": "post-traitement",
}


@dataclass
class Job:
    """Une demande de génération. Les valeurs par défaut sont celles d'un brouillon."""

    model: str
    image: str
    prompt: str
    negative_prompt: str = "worst quality, inconsistent motion, blurry, jittery, distorted"
    width: int = 1280
    height: int = 720
    seconds: float = 5.0
    fps: float = 24.0
    steps: int | None = None
    guidance: float | None = None
    seed: int | None = None
    audio: bool = True
    mode: str = "draft"
    # auto | gpu | cpu_offload | group_offload
    memory: str = "auto"
    compile: bool = False
    sage: bool = False
    out_dir: str = "."
    name: str = ""
    # {"fps": 48, "upscale": 2}
    post: dict[str, Any] = field(default_factory=dict)

    @property
    def num_frames(self) -> int:
        """Nombre d'images : les modèles veulent 8k+1 (LTX) ou 4k+1 (Wan) ; on arrondit au-dessus."""
        n = int(round(self.seconds * self.fps))
        return ((n - 1 + 7) // 8) * 8 + 1


@dataclass
class Timings:
    load: float = 0.0
    encode: float = 0.0
    sample: float = 0.0
    decode: float = 0.0
    write: float = 0.0
    post: float = 0.0
    seconds_per_step: float = 0.0

    @property
    def total(self) -> float:
        return self.load + self.encode + self.sample + self.decode + self.write + self.post


class Emitter:
    """Écrit les événements sur stdout, de façon sûre entre threads."""

    def __init__(self, out=None):
        self.out = out or sys.stdout
        self.lock = threading.Lock()
        self.job_id: int | None = None

    def emit(self, event: str, **data: Any) -> None:
        msg = {"event": event, **data}
        if self.job_id is not None and "id" not in msg:
            msg["id"] = self.job_id
        line = json.dumps(msg, ensure_ascii=False, default=_json_default)
        with self.lock:
            self.out.write(line + "\n")
            self.out.flush()

    def stage(self, name: str, status: str, seconds: float | None = None, **detail: Any) -> None:
        self.emit("stage", stage=name, label=STAGE_LABELS.get(name, name), status=status, seconds=seconds, **detail)

    def progress(self, step: int, total: int, seconds_per_step: float) -> None:
        self.emit("progress", step=step, total=total, seconds_per_step=round(seconds_per_step, 3))

    def log(self, text: str) -> None:
        self.emit("log", text=text)


def _json_default(o: Any) -> Any:
    if hasattr(o, "__dataclass_fields__"):
        return asdict(o)
    return str(o)


def job_from_dict(d: dict[str, Any]) -> Job:
    known = {k: v for k, v in d.items() if k in Job.__dataclass_fields__}
    return Job(**known)
