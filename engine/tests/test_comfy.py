import io
import json

import pytest

from videoarms import models
from videoarms.comfy.server import ComfyServer
from videoarms.comfy.workflow import analyze, fill, load_workflow
from videoarms.protocol import Emitter, Job
from videoarms.server import Engine

from .fake_comfy import FakeComfy

I2V_WF = {
    "1": {"class_type": "LoadImage", "inputs": {"image": "exemple.png"}, "_meta": {"title": "Load Image"}},
    "2": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "ltx.safetensors"}},
    "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "ancien prompt", "clip": ["2", 1]}, "_meta": {"title": "CLIP Text Encode (Positive)"}},
    "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "flou", "clip": ["2", 1]}, "_meta": {"title": "CLIP Text Encode (Negative)"}},
    "5": {"class_type": "EmptyLTXVLatentVideo", "inputs": {"width": 768, "height": 512, "length": 97, "batch_size": 1}},
    "6": {"class_type": "KSampler", "inputs": {"seed": 1, "steps": 30, "cfg": 3.0, "denoise": 1.0, "model": ["2", 0], "positive": ["3", 0], "negative": ["4", 0], "latent_image": ["5", 0]}},
    "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["2", 2]}},
    "9": {"class_type": "SaveVideo", "inputs": {"video": ["7", 0], "fps": 24, "filename_prefix": "video"}},
}


@pytest.fixture
def wf_dir(tmp_path):
    d = tmp_path / "workflows"
    d.mkdir()
    (d / "ltx_i2v.json").write_text(json.dumps(I2V_WF))
    audio = {"1": {"class_type": "TextEncodeAceStepAudio", "inputs": {"tags": "piano calme", "lyrics": "", "seconds": 30}},
             "2": {"class_type": "KSampler", "inputs": {"seed": 5, "steps": 20, "cfg": 4, "positive": ["1", 0]}},
             "3": {"class_type": "SaveAudio", "inputs": {"audio": ["2", 0]}}}
    (d / "musique.json").write_text(json.dumps(audio))
    (d / "interface.json").write_text(json.dumps({"nodes": [], "links": []}))
    return d


def test_analyze_finds_parameters():
    a = analyze(I2V_WF)
    assert (a.kind, a.needs_image, a.tasks) == ("video", True, ["i2v"])
    assert a.params["image"] == [("1", "image")]
    assert a.params["prompt"] == [("3", "text")] and a.params["negative_prompt"] == [("4", "text")]
    assert a.params["seed"] == [("6", "seed")] and a.params["steps"] == [("6", "steps")] and a.params["guidance"] == [("6", "cfg")]
    assert a.params["width"] == [("5", "width")] and a.params["num_frames"] == [("5", "length")] and a.params["fps_out"] == [("9", "fps")]
    filled = fill(I2V_WF, a, {"prompt": "nouveau", "seed": 42, "width": 1280.0, "height": 720, "num_frames": 121, "steps": None})
    assert filled["3"]["inputs"]["text"] == "nouveau" and filled["6"]["inputs"]["seed"] == 42
    assert filled["5"]["inputs"]["width"] == 1280 and isinstance(filled["5"]["inputs"]["width"], int)
    assert filled["6"]["inputs"]["steps"] == 30, "None = inchangé"
    assert I2V_WF["3"]["inputs"]["text"] == "ancien prompt", "l'original n'est pas modifié"


def test_workflows_become_models(wf_dir):
    found = models.scan_workflows(str(wf_dir))
    by = {m.path.rsplit("/", 1)[-1]: m for m in found}
    assert by["ltx_i2v.json"].tasks == ["i2v"] and by["ltx_i2v.json"].kind == "video" and by["ltx_i2v.json"].supported
    assert by["musique.json"].kind == "audio" and by["musique.json"].tasks == ["t2a"]
    assert not by["interface.json"].supported and "Export (API)" in by["interface.json"].note


def test_load_workflow_rejects_ui_format(tmp_path):
    p = tmp_path / "ui.json"
    p.write_text(json.dumps({"nodes": [1], "links": []}))
    with pytest.raises(ValueError, match="Export"):
        load_workflow(p)


def test_generate_through_fake_comfy(image, wf_dir, tmp_path):
    fake = FakeComfy()
    try:
        out = io.StringIO()
        engine = Engine(Emitter(out))
        engine.probe([], {"dir": None, "port": fake.port}, str(wf_dir))
        model = next(m for m in engine.models if m.path.endswith("ltx_i2v.json"))
        job = Job(model=model.id, task="i2v", image=str(image), prompt="la mer", seed=7, width=640, height=352, seconds=5, fps=24, out_dir=str(tmp_path / "out"))
        res = engine.generate(job)
        assert res["kind"] == "video" and res["path"].endswith("_comfyui_i2v.mp4")
        assert open(res["path"], "rb").read() == b"FAKE:out.mp4"
        sent = fake.received[0]["wf"]
        assert sent["3"]["inputs"]["text"] == "la mer" and sent["6"]["inputs"]["seed"] == 7
        assert sent["1"]["inputs"]["image"] == fake.uploads[0]
        assert sent["5"]["inputs"] == {"width": 640, "height": 352, "length": 121, "batch_size": 1}
        assert sent["9"]["inputs"]["fps"] == 24
        events = [json.loads(l) for l in out.getvalue().splitlines()]
        assert any(e["event"] == "stage" and e["stage"] == "write" and e["status"] == "end" for e in events)
        # Serveur externe : on ne l'arrête pas.
        assert engine.comfy.external and engine.comfy.proc is None
    finally:
        fake.stop()


def test_missing_nodes_are_reported(image, wf_dir, tmp_path):
    fake = FakeComfy(missing=["EmptyLTXVLatentVideo"])
    try:
        engine = Engine(Emitter(io.StringIO()))
        engine.probe([], {"dir": None, "port": fake.port}, str(wf_dir))
        model = next(m for m in engine.models if m.path.endswith("ltx_i2v.json"))
        chk = engine.workflow_check(model.id)
        assert chk["missing"] == ["EmptyLTXVLatentVideo"]
        with pytest.raises(RuntimeError, match="nœuds absents"):
            engine.generate(Job(model=model.id, task="i2v", image=str(image), prompt="x", out_dir=str(tmp_path)))
    finally:
        fake.stop()


def test_import_workflow(wf_dir, tmp_path):
    engine = Engine(Emitter(io.StringIO()))
    dest = tmp_path / "wfs"
    engine.probe([], None, str(dest))
    r = engine.import_workflow(str(wf_dir / "ltx_i2v.json"))
    assert (dest / "ltx_i2v.json").is_file() and r["analysis"]["tasks"] == ["i2v"]
    assert engine.models[0].backend == "comfy"


def test_comfy_server_without_install():
    s = ComfyServer(None, port=1)
    st = s.status()
    assert st["found"] is False and st["running"] is False
    with pytest.raises(RuntimeError, match="dossier ComfyUI"):
        s.start()


def test_mock_3d_and_audio(image, tmp_path):
    engine = Engine(Emitter(io.StringIO()))
    engine.probe([])
    r = engine.generate(Job(model="mock", task="i23d", image=str(image), prompt="", out_dir=str(tmp_path)))
    assert r["kind"] == "3d" and r["path"].endswith("_test_i23d.glb")
    assert open(r["path"], "rb").read(4) == b"glTF"
    r = engine.generate(Job(model="mock", task="t2a", prompt="piano calme", seconds=2, out_dir=str(tmp_path)))
    assert r["kind"] == "audio" and r["path"].endswith(".mp3") and r["audio"]
    from videoarms.video import probe_video

    assert 1.5 < probe_video(r["path"])["seconds"] < 2.6


def test_variants_chosen_by_free_vram(image, tmp_path):
    """`ltx25@16.json` et `ltx25@8.json` → un seul workflow ; la variante dépend de la VRAM libre."""
    d = tmp_path / "wfs"
    d.mkdir()
    big = json.loads(json.dumps(I2V_WF))
    big["5"]["inputs"]["width"] = 1920
    (d / "ltx25@16.json").write_text(json.dumps(big))
    (d / "ltx25@8.json").write_text(json.dumps(I2V_WF))
    found = models.scan_workflows(str(d))
    assert len(found) == 1 and len(found[0].variants) == 2 and found[0].variants[0]["min_vram_gb"] == 16
    for free, expected in [(9000, "ltx25@8"), (20000, "ltx25@16")]:
        fake = FakeComfy(vram_total_mb=24576, vram_free_mb=free)
        try:
            out = io.StringIO()
            engine = Engine(Emitter(out))
            engine.probe([], {"dir": None, "port": fake.port}, str(d))
            res = engine.generate(Job(model=found[0].id, task="i2v", image=str(image), prompt="x", out_dir=str(tmp_path / "out")))
            assert res["memory"]["variant"] == expected, out.getvalue()
            assert res["settings"]["workflow"] == f"{expected}.json"
            # La VRAM utilisée pendant le job est mesurée depuis ComfyUI.
            assert res["vram_peak_mb"] >= 24576 - free + 5000, res["vram_peak_mb"]
        finally:
            fake.stop()
    # Variante imposée.
    fake = FakeComfy(vram_free_mb=20000)
    try:
        engine = Engine(Emitter(io.StringIO()))
        engine.probe([], {"dir": None, "port": fake.port}, str(d))
        res = engine.generate(Job(model=found[0].id, task="i2v", image=str(image), prompt="x", variant="ltx25@8", out_dir=str(tmp_path / "out")))
        assert res["memory"]["variant"] == "ltx25@8"
    finally:
        fake.stop()
