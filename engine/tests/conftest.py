import numpy as np
import pytest
from PIL import Image


@pytest.fixture
def image(tmp_path):
    h, w = 90, 160
    ys, xs = np.mgrid[0:h, 0:w]
    arr = np.stack([xs * 255 // w, ys * 255 // h, np.full((h, w), 120)], axis=-1).astype(np.uint8)
    p = tmp_path / "test.png"
    Image.fromarray(arr).save(p)
    return p


@pytest.fixture
def fake_models(tmp_path):
    """Un cache HF avec LTX-2.3 distillé et Wan 2.2 5B, un dossier ComfyUI LTX-2.5, un dossier SDXL (ignoré)."""
    import json

    def diffusers_model(folder, cls, comps):
        folder.mkdir(parents=True)
        (folder / "model_index.json").write_text(json.dumps({"_class_name": cls, **{c: ["x", "y"] for c in comps}}))
        for c in comps:
            (folder / c).mkdir()
            (folder / c / "w.safetensors").write_bytes(b"0" * 1000)

    root = tmp_path / "models"
    diffusers_model(root / "models--diffusers--LTX-2.3-Distilled-Diffusers/snapshots/abc", "LTX2Pipeline",
                    ["transformer", "vae", "audio_vae", "text_encoder", "vocoder", "connectors", "scheduler", "tokenizer"])
    diffusers_model(root / "models--Wan-AI--Wan2.2-TI2V-5B-Diffusers/snapshots/def", "WanImageToVideoPipeline",
                    ["transformer", "vae", "text_encoder", "scheduler", "tokenizer"])
    diffusers_model(root / "models--SG161222--RealVisXL_V5.0/snapshots/ghi", "StableDiffusionXLPipeline", ["unet", "vae"])
    comfy = root / "LTX-2.5"
    (comfy / "transformer_gguf").mkdir(parents=True)
    (comfy / "transformer_gguf" / "LTX-2.5-Distilled-Q4_K_S.gguf").write_bytes(b"0" * 10)
    return root
