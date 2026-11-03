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
    diffusers_model(root / "models--SG161222--RealVisXL_V5.0/snapshots/ghi", "StableDiffusionXLPipeline", ["unet", "vae", "text_encoder", "text_encoder_2"])
    diffusers_model(root / "models--h94--IP-Adapter/snapshots/jkl", "IPAdapter", ["models"])

    def single_file(path, keys, size):
        """Un faux .safetensors : vrai en-tête, poids remplacés par des zéros clairsemés."""
        import struct

        path.parent.mkdir(parents=True, exist_ok=True)
        header = json.dumps({k: {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]} for k in keys}).encode()
        with open(path, "wb") as f:
            f.write(struct.pack("<Q", len(header)) + header)
            f.truncate(size)

    single_file(root / "SDXL_merge/Juggernaut_X_v10.safetensors", ["conditioner.embedders.1.model.x", "model.diffusion_model.y"], 6_900_000_000)
    single_file(root / "SD15_merge/DreamShaper_Turbo.safetensors", ["cond_stage_model.transformer.x", "model.diffusion_model.y"], 2_100_000_000)
    single_file(root / "petit.safetensors", ["model.x"], 10_000)
    comfy = root / "LTX-2.5"
    (comfy / "transformer_gguf").mkdir(parents=True)
    (comfy / "transformer_gguf" / "LTX-2.5-Distilled-Q4_K_S.gguf").write_bytes(b"0" * 10)
    return root
