import io
import json
import subprocess
import sys
import threading

import numpy as np

from videoarms import memory, models
from videoarms.protocol import Emitter, Job
from videoarms.server import Engine, serve
from videoarms.video import post_process, probe_video, write_video


def test_scan_finds_video_models_and_ignores_sdxl(fake_models):
    found = models.scan([str(fake_models)], include_mock=False)
    names = [(m.backend, m.name, m.supported) for m in found]
    assert ("ltx2", "diffusers/LTX-2.3-Distilled-Diffusers", True) in names
    assert ("wan", "Wan-AI/Wan2.2-TI2V-5B-Diffusers", True) in names
    assert any(b == "comfy" and not ok for b, _, ok in names)
    assert not any("RealVis" in n for _, n, _ in names)
    ltx = next(m for m in found if m.backend == "ltx2")
    assert ltx.distilled and ltx.audio and "transformer" in ltx.components


def test_memory_plan_follows_vram_ram_and_steps():
    # Tient dans la VRAM.
    assert memory.plan("auto", 5.0, 10240, 50000, 1280, 720, 8).strategy == "gpu"
    # Trop gros, 8 étapes, 64 Go de RAM : streaming des blocs (l'idée Strata).
    p = memory.plan("auto", 15.0, 10240, 50000, 1280, 720, 8)
    assert (p.strategy, p.vae_tiling) == ("group_offload", True)
    # Trop gros et 50 étapes : composant par composant.
    assert memory.plan("auto", 15.0, 10240, 50000, 1280, 720, 50).strategy == "cpu_offload"
    # Pas assez de RAM.
    assert memory.plan("auto", 15.0, 10240, 8000, 1280, 720, 8).strategy == "cpu_offload"
    assert memory.plan("gpu", 15.0, 10240, 8000, 640, 360, 8).strategy == "gpu"


def test_fit_and_crop():
    from videoarms.backends import crop_center, fit_dims

    assert fit_dims(1920, 1080, 32) == (1920, 1088)
    assert fit_dims(1280, 720, 16) == (1280, 720)
    big = np.arange(2 * 1088 * 1920 * 3, dtype=np.uint8).reshape(2, 1088, 1920, 3)
    assert crop_center(big, 1920, 1080).shape == (2, 1080, 1920, 3)


def test_job_frames_rounding():
    assert Job(model="m", image="i", prompt="p", seconds=5, fps=24).num_frames == 121
    assert Job(model="m", image="i", prompt="p", seconds=10, fps=24).num_frames == 241


def test_mock_generation_end_to_end(image, tmp_path):
    out = io.StringIO()
    em = Emitter(out)
    engine = Engine(em)
    engine.probe([])
    job = Job(model="mock", image=str(image), prompt="zoom", width=160, height=96, seconds=1, fps=12, out_dir=str(tmp_path / "out"), post={"fps": 24})
    res = engine.generate(job)
    assert res["frames"] == 17 and res["audio"] is True
    assert res["path"].endswith("_final.mp4") and res["raw_path"].endswith(".mp4")
    events = [json.loads(l) for l in out.getvalue().splitlines()]
    stages = [(e["stage"], e["status"]) for e in events if e["event"] == "stage"]
    assert stages[0] == ("load", "start") and ("post", "end") in stages and ("write", "end") in stages
    assert any(e["event"] == "progress" and e["step"] == e["total"] for e in events)
    # La vidéo finale est bien interpolée à 24 i/s, avec son audio.
    meta = probe_video(res["path"])
    assert round(meta["fps"]) == 24 and meta["audio"] and (meta["width"], meta["height"]) == (160, 96)


def test_write_video_with_audio(tmp_path):
    frames = np.zeros((6, 32, 48, 3), dtype=np.uint8)
    audio = np.zeros((2, 24000 // 4), dtype=np.float32)
    p = write_video(frames, tmp_path / "a.mp4", 24, audio)
    assert p.stat().st_size > 0
    assert probe_video(p)["audio"]
    q = post_process(p, tmp_path / "b.mp4", upscale=2)
    assert (probe_video(q)["width"], probe_video(q)["height"]) == (96, 64)


def test_server_protocol_over_pipes(image, tmp_path):
    """Le vrai sous-processus : probe, generate, cancel pendant la génération."""
    proc = subprocess.Popen([sys.executable, "-m", "videoarms.server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    lines = []

    def reader():
        for l in proc.stdout:
            lines.append(json.loads(l))

    th = threading.Thread(target=reader, daemon=True)
    th.start()

    def send(msg):
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()

    send({"id": 1, "cmd": "probe", "paths": []})
    send({"id": 2, "cmd": "generate", "job": {"model": "mock", "image": str(image), "prompt": "x", "width": 160, "height": 96, "seconds": 1, "fps": 12, "out_dir": str(tmp_path)}})
    import time

    deadline = time.time() + 60
    while time.time() < deadline and not any(e.get("event") == "done" for e in lines):
        time.sleep(0.1)
    send({"id": 3, "cmd": "generate", "job": {"model": "mock", "image": str(image), "prompt": "x", "width": 640, "height": 360, "seconds": 5, "steps": 200, "out_dir": str(tmp_path)}})
    time.sleep(0.6)
    send({"cmd": "cancel"})
    while time.time() < deadline and not any(e.get("event") == "cancelled" for e in lines):
        time.sleep(0.1)
    send({"cmd": "quit"})
    proc.wait(timeout=10)
    evs = [e["event"] for e in lines]
    assert evs[0] == "ready" and "probe" in evs and "done" in evs and "cancelled" in evs
    done = next(e for e in lines if e["event"] == "done")
    assert done["id"] == 2 and done["timings"]["total"] > 0
