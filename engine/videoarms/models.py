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
    ("StableDiffusionXL", "sd", "SDXL", False),
    ("StableDiffusionPipeline", "sd", "SD 1.5", False),
    ("StableDiffusionImg2Img", "sd", "SD 1.5", False),
]

# Ce que chaque backend sait faire.
TASKS_OF = {"ltx2": ["i2v", "t2v"], "wan": ["i2v", "t2v"], "sd": ["t2i", "i2i"], "mock": ["i2v", "t2v", "t2i", "i2i", "i23d", "t23d", "t2a"], "comfy": []}


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
    # video | image
    kind: str = "video"
    tasks: list[str] = field(default_factory=list)

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
    if backend == "sd" and "unet" not in comps:
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
        distilled=any(k in name.lower() for k in ("distill", "turbo", "lightning")),
        components=comps,
        kind="image" if backend == "sd" else "video",
        tasks=TASKS_OF[backend],
    )
    if backend == "sd" and "playground" in name.lower():
        info.note = "Playground v2.5 : échantillonneur EDM, résultats possibles mais non vérifiés"
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
        note="format ComfyUI : exporte un workflow (API) qui l'utilise, puis importe-le dans les réglages",
    )


def safetensors_keys(path: Path, limit: int = 4000) -> list[str]:
    """Les clés de l'en-tête d'un fichier .safetensors, sans lire les poids."""
    import struct

    try:
        with open(path, "rb") as f:
            n = struct.unpack("<Q", f.read(8))[0]
            if n > 200_000_000:
                return []
            header = json.loads(f.read(n))
        return [k for k in header if k != "__metadata__"][:limit]
    except Exception:
        return []


def read_single_file(path: Path) -> ModelInfo | None:
    """Un checkpoint Stable Diffusion en un seul fichier (SDXL, SD 1.5, SD 2)."""
    if path.suffix.lower() not in (".safetensors", ".ckpt") or path.stat().st_size < 1_000_000_000:
        return None
    keys = safetensors_keys(path) if path.suffix.lower() == ".safetensors" else []
    if not keys and path.suffix.lower() == ".safetensors":
        return None
    family = None
    if any(k.startswith("conditioner.embedders.1") for k in keys):
        family = "SDXL"
    elif any(k.startswith("cond_stage_model.transformer") for k in keys):
        family = "SD 1.5"
    elif any(k.startswith("cond_stage_model.model") for k in keys):
        family = "SD 2"
    elif any(k.startswith("model.diffusion_model") for k in keys):
        family = "SD"
    elif keys:
        return None
    if family is None:
        family = "SDXL" if path.stat().st_size > 5_000_000_000 else "SD 1.5"
    name = path.stem
    return ModelInfo(
        id=f"sd:{path.resolve()}",
        name=f"{name} ({family})",
        path=str(path.resolve()),
        backend="sd",
        family=family,
        format="single_file",
        size_gb=round(path.stat().st_size / 1e9, 1),
        distilled=any(k in name.lower() for k in ("turbo", "lightning", "lcm")),
        kind="image",
        tasks=TASKS_OF["sd"],
    )


def read_workflow(path: Path) -> ModelInfo | None:
    """Un workflow ComfyUI importé devient un « modèle » exécuté par ComfyUI."""
    from .comfy.workflow import analyze, load_workflow

    try:
        a = analyze(load_workflow(path))
    except Exception as e:
        return ModelInfo(id=f"comfy:{path.resolve()}", name=path.stem, path=str(path.resolve()), backend="comfy", family="ComfyUI",
                         format="workflow", supported=False, note=f"workflow illisible : {e}", kind="video", tasks=[])
    return ModelInfo(
        id=f"comfy:{path.resolve()}",
        name=f"{path.stem} (ComfyUI)",
        path=str(path.resolve()),
        backend="comfy",
        family="ComfyUI",
        format="workflow",
        size_gb=0.0,
        audio=a.kind == "audio",
        kind=a.kind,
        tasks=a.tasks,
        note=" ; ".join(a.warnings),
    )


def scan_workflows(folder: str | None) -> list[ModelInfo]:
    if not folder:
        return []
    root = Path(folder).expanduser()
    if not root.is_dir():
        return []
    out = [read_workflow(p) for p in sorted(root.glob("*.json"))]
    return [m for m in out if m]


def hf_display_name(cache_entry: Path) -> str:
    # models--diffusers--LTX-2.3-Distilled-Diffusers → diffusers/LTX-2.3-Distilled-Diffusers
    return cache_entry.name[len("models--"):].replace("--", "/")


def scan(paths: list[str], include_mock: bool = True, workflows_dir: str | None = None) -> list[ModelInfo]:
    found: dict[str, ModelInfo] = {}
    for m in scan_workflows(workflows_dir):
        found[m.id] = m
    for raw in paths:
        root = Path(raw).expanduser()
        if not root.is_dir():
            continue
        candidates: list[tuple[Path, str | None]] = [(root, None)]
        files: list[Path] = []
        try:
            for child in root.iterdir():
                if child.is_file():
                    files.append(child)
                    continue
                if not child.is_dir():
                    continue
                if child.name.startswith("models--"):
                    snaps = child / "snapshots"
                    if snaps.is_dir():
                        for snap in snaps.iterdir():
                            candidates.append((snap, hf_display_name(child)))
                else:
                    candidates.append((child, None))
                    # Checkpoints rangés dans un sous-dossier (SDXL_merge/, SD15_merge/…).
                    try:
                        files.extend(f for f in child.iterdir() if f.is_file())
                    except OSError:
                        pass
        except OSError:
            continue
        for folder, display in candidates:
            info = read_diffusers(folder, display) or read_comfy(folder)
            if info:
                found[info.id] = info
        for f in files:
            info = read_single_file(f)
            if info:
                found[info.id] = info
    out = sorted(found.values(), key=lambda m: (not m.supported, m.kind, m.backend, m.name))
    if include_mock:
        out.append(ModelInfo(
            id="mock", name="Moteur factice (test, sans GPU)", path="", backend="mock", family="test",
            format="mock", audio=True, distilled=True, note="produit une vraie vidéo ou image sans modèle",
            kind="video", tasks=TASKS_OF["mock"],
        ))
    return out


def find(models: list[ModelInfo], model_id: str) -> ModelInfo | None:
    for m in models:
        if m.id == model_id:
            return m
    return None
