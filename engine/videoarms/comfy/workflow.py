"""Lecture d'un workflow ComfyUI au format API et repérage de ses paramètres.

Un workflow API est un dict `id → {class_type, inputs, _meta.title}`. On y
cherche, sans rien supposer du modèle : l'image d'entrée, les prompts, la
graine, les étapes, le guidage, la taille, la durée, la cadence. Ce qui n'est
pas trouvé reste tel que dans le fichier.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

VIDEO_SAVERS = ("SaveVideo", "VHS_VideoCombine", "CreateVideo", "SaveAnimatedWEBP", "SaveAnimatedPNG", "SaveWEBM")
IMAGE_SAVERS = ("SaveImage", "PreviewImage")
AUDIO_SAVERS = ("SaveAudio", "SaveAudioMP3", "SaveAudioOpus", "PreviewAudio")
MESH_SAVERS = ("SaveGLB", "Save3D", "SaveMesh", "Hunyuan3DExport", "ExportMesh", "SaveOBJ")


@dataclass
class Analysis:
    kind: str = "video"                    # video | image | audio | 3d
    needs_image: bool = False
    # paramètre → [(id de nœud, nom d'entrée)]
    params: dict[str, list[tuple[str, str]]] = field(default_factory=dict)
    class_types: list[str] = field(default_factory=list)
    nodes: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def tasks(self) -> list[str]:
        src = "i" if self.needs_image else "t"
        return [f"{src}2{ {'video': 'v', 'image': 'i', 'audio': 'a', '3d': '3d'}[self.kind] }"]

    def to_dict(self) -> dict:
        return {"kind": self.kind, "needs_image": self.needs_image, "tasks": self.tasks, "nodes": self.nodes,
                "params": {k: [list(x) for x in v] for k, v in self.params.items()}, "class_types": self.class_types, "warnings": self.warnings}


def load_workflow(path: str | Path) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict) and "nodes" in data and "links" in data:
        raise ValueError("ce fichier est un workflow au format interface (nœuds + liens) : dans ComfyUI, utilise « Export (API) »")
    if not isinstance(data, dict) or not all(isinstance(v, dict) and "class_type" in v for v in data.values()):
        raise ValueError("ce fichier n'est pas un workflow ComfyUI au format API")
    return data


def _title(node: dict) -> str:
    return str(node.get("_meta", {}).get("title", "")).lower()


def analyze(wf: dict) -> Analysis:
    a = Analysis()
    a.nodes = len(wf)
    a.class_types = sorted({n["class_type"] for n in wf.values()})
    classes = set(a.class_types)
    if any(c in classes for c in MESH_SAVERS) or any(("3d" in c.lower() or "glb" in c.lower() or "mesh" in c.lower()) and "save" in c.lower() for c in classes):
        a.kind = "3d"
    elif any(c in classes for c in AUDIO_SAVERS):
        a.kind = "audio"
    elif any(c in classes for c in VIDEO_SAVERS) or any("video" in c.lower() and "save" in c.lower() for c in classes):
        a.kind = "video"
    elif any(c in classes for c in IMAGE_SAVERS):
        a.kind = "image"
    else:
        a.warnings.append("aucun nœud de sauvegarde reconnu : le type de sortie sera deviné à l'exécution")

    def add(param: str, nid: str, inp: str):
        a.params.setdefault(param, []).append((nid, inp))

    # Entrées « négatives » : repérées par ce qui est branché sur une entrée `negative` d'un sampler.
    negative_ids = {v[0] for n in wf.values() for k, v in n["inputs"].items() if k == "negative" and isinstance(v, list)}
    positive_ids = {v[0] for n in wf.values() for k, v in n["inputs"].items() if k == "positive" and isinstance(v, list)}

    for nid, node in wf.items():
        ct, inputs, title = node["class_type"], node["inputs"], _title(node)
        if ct == "LoadImage" or (ct.startswith("LoadImage") and "image" in inputs):
            add("image", nid, "image")
            a.needs_image = True
        if "text" in inputs and isinstance(inputs["text"], str) and ("TextEncode" in ct or "Prompt" in ct or "Text" in ct):
            if nid in negative_ids or "neg" in title:
                add("negative_prompt", nid, "text")
            elif nid in positive_ids or "pos" in title or "prompt" in title or nid not in negative_ids:
                add("prompt", nid, "text")
        # Certains nœuds portent le prompt sous d'autres noms (LTX, Hunyuan, ACE-Step…).
        for key in ("prompt", "positive_prompt", "tags", "lyrics"):
            if key in inputs and isinstance(inputs[key], str) and "TextEncode" not in ct:
                add("prompt" if key != "lyrics" else "lyrics", nid, key)
        for key in ("negative_prompt",):
            if key in inputs and isinstance(inputs[key], str):
                add("negative_prompt", nid, key)
        for key in ("seed", "noise_seed"):
            if key in inputs and not isinstance(inputs[key], list):
                add("seed", nid, key)
        if "steps" in inputs and not isinstance(inputs["steps"], list):
            add("steps", nid, "steps")
        for key in ("cfg", "guidance", "guidance_scale"):
            if key in inputs and not isinstance(inputs[key], list):
                add("guidance", nid, key)
        if "width" in inputs and "height" in inputs and not isinstance(inputs["width"], list):
            add("width", nid, "width")
            add("height", nid, "height")
        for key in ("length", "num_frames", "frames", "frame_count"):
            if key in inputs and not isinstance(inputs[key], list):
                add("num_frames", nid, key)
        for key in ("fps", "frame_rate"):
            if key in inputs and not isinstance(inputs[key], list) and "Save" not in ct and "Combine" not in ct and "CreateVideo" not in ct:
                add("fps", nid, key)
        for key in ("fps", "frame_rate"):
            if key in inputs and not isinstance(inputs[key], list) and (ct in VIDEO_SAVERS or "Combine" in ct):
                add("fps_out", nid, key)
        if "denoise" in inputs and not isinstance(inputs["denoise"], list):
            add("strength", nid, "denoise")
        for key in ("seconds", "duration"):
            if key in inputs and not isinstance(inputs[key], list):
                add("seconds", nid, key)
    if "prompt" not in a.params:
        a.warnings.append("aucun champ de prompt repéré : le texte du workflow sera utilisé tel quel")
    if "seed" not in a.params:
        a.warnings.append("aucune graine repérée : chaque exécution utilisera celle du fichier")
    return a


def fill(wf: dict, analysis: Analysis, values: dict) -> dict:
    """Copie du workflow avec les valeurs injectées (clés absentes ou None : inchangées)."""
    import copy

    out = copy.deepcopy(wf)
    for param, targets in analysis.params.items():
        if values.get(param) is None:
            continue
        for nid, inp in targets:
            current = out[nid]["inputs"].get(inp)
            v = values[param]
            if isinstance(current, int) and not isinstance(current, bool) and isinstance(v, float):
                v = int(round(v))
            out[nid]["inputs"][inp] = v
    return out
