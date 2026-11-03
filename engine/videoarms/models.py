"""Repérage des modèles vidéo présents sur le disque. Rien n'est téléchargé.

Deux formes sont reconnues :
- un dossier au format diffusers (`model_index.json`), directement ou dans un
  cache Hugging Face (`models--Org--Nom/snapshots/<hash>/`) ;
- un dossier « ComfyUI » (fichiers `.gguf` / `.safetensors` séparés), signalé
  mais pas encore pris en charge par ce moteur.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

# (indice dans le nom ou la classe du pipeline) → (backend, famille, audio)
KNOWN = [
    ("LTX2", "ltx2", "LTX-2", True),
    ("ltx-2", "ltx2", "LTX-2", True),
    ("ltx2", "ltx2", "LTX-2", True),
    ("Wan", "wan", "Wan", False),
]


@dataclass
class ModelInfo:
    id: str
    name: str
    path: str
    backend: str          # ltx2 | wan | comfy | mock
    family: str
    format: str           # diffusers | comfy | mock
    size_gb: float = 0.0
    audio: bool = False
    distilled: bool = False
    supported: bool = True
    note: str = ""
    components: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def dir_size_gb(p: Path) -> float:
    total = 0
    for root, _, files in os.walk(p):
        for f in files:
            try:
                fp = Path(root, f)
                # Les caches HF pointent vers des blobs : compter la taille réelle.
                total += fp.stat().st_size
            except OSError:
                pass
    return round(total / 1e9, 1)


def classify(name: str, pipeline_class: str) -> tuple[str, str, bool] | None:
    hay = f"{name} {pipeline_class}"
    for key, backend, family, audio in KNOWN:
        if key.lower() in hay.lower():
            return backend, family, audio
    return None


def read_diffusers(folder: Path, display: str | None = None) -> ModelInfo | None:
    idx = folder / "model_index.json"
    if not idx.is_file():
        return None
    try:
        meta = json.loads(idx.read_text(encoding="utf-8"))
    except Exception:
        return None
    name = display or folder.name
    cls = meta.get("_class_name", "")
    kind = classify(name, cls)
    if not kind:
        return None
    backend, family, audio = kind
    comps = sorted(k for k in meta if not k.startswith("_") and (folder / k).is_dir())
    if backend == "ltx2" and "transformer" not in comps:
        return None
    info = ModelInfo(
        id=f"{backend}:{folder.resolve()}",
        name=name,
        path=str(folder.resolve()),
        backend=backend,
        family=family,
        format="diffusers",
        size_gb=dir_size_gb(folder),
        audio=audio,
        distilled="distill" in name.lower() or "turbo" in name.lower(),
        components=comps,
    )
    if backend == "wan" and "5B" not in name and "1.3B" not in name:
        info.note = "modèle 14B : très lent sur 10 Go de VRAM, à réserver au rendu final"
    return info


def read_comfy(folder: Path) -> ModelInfo | None:
    """Dossier LTX-2.5 (ou autre) au format ComfyUI : signalé, pas encore utilisable ici."""
    ggufs = list(folder.rglob("*.gguf"))
    if not ggufs:
        return None
    name = folder.name
    kind = classify(name, "") or classify(ggufs[0].name, "")
    if not kind:
        return None
    _, family, audio = kind
    return ModelInfo(
        id=f"comfy:{folder.resolve()}",
        name=f"{name} ({ggufs[0].name})",
        path=str(folder.resolve()),
        backend="comfy",
        family=family,
        format="comfy",
        size_gb=dir_size_gb(folder),
        audio=audio,
        distilled="distill" in ggufs[0].name.lower(),
        supported=False,
        note="format GGUF/ComfyUI : pas encore pris en charge par ce moteur (prévu via ComfyUI)",
    )


def hf_display_name(cache_entry: Path) -> str:
    # models--diffusers--LTX-2.3-Distilled-Diffusers → diffusers/LTX-2.3-Distilled-Diffusers
    return cache_entry.name[len("models--"):].replace("--", "/")


def scan(paths: list[str], include_mock: bool = True) -> list[ModelInfo]:
    found: dict[str, ModelInfo] = {}
    for raw in paths:
        root = Path(raw).expanduser()
        if not root.is_dir():
            continue
        candidates: list[tuple[Path, str | None]] = [(root, None)]
        try:
            for child in root.iterdir():
                if not child.is_dir():
                    continue
                if child.name.startswith("models--"):
                    snaps = child / "snapshots"
                    if snaps.is_dir():
                        for snap in snaps.iterdir():
                            candidates.append((snap, hf_display_name(child)))
                else:
                    candidates.append((child, None))
        except OSError:
            continue
        for folder, display in candidates:
            info = read_diffusers(folder, display) or read_comfy(folder)
            if info:
                found[info.id] = info
    out = sorted(found.values(), key=lambda m: (not m.supported, m.backend, m.name))
    if include_mock:
        out.append(ModelInfo(
            id="mock", name="Moteur factice (test, sans GPU)", path="", backend="mock", family="test",
            format="mock", audio=True, distilled=True, note="produit une vraie vidéo à partir de l'image, sans modèle",
        ))
    return out


def find(models: list[ModelInfo], model_id: str) -> ModelInfo | None:
    for m in models:
        if m.id == model_id:
            return m
    return None
