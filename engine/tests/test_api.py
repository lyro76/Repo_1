import io
import json
import subprocess
import sys
import threading
import time
import urllib.request

from videoarms.api import ApiServer
from videoarms.protocol import Emitter
from videoarms.server import Engine


def http(url, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def wait_done(url, jid, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = http(f"{url}/jobs/{jid}")
        if j["state"] in ("done", "error", "cancelled"):
            return j
        time.sleep(0.1)
    raise AssertionError("job trop long")


def test_http_api_drives_the_engine(image, tmp_path):
    out = io.StringIO()
    engine = Engine(Emitter(out))
    engine.probe([])
    r = engine.set_api(True, 0, None, str(tmp_path))
    url = r["url"]
    try:
        st = http(f"{url}/status")
        assert st["loaded"] is None and any(m["id"] == "mock" for m in st["models"])
        jid = http(f"{url}/jobs", "POST", {"task": "t2i", "model": "mock", "prompt": "un chat", "width": 64, "height": 64, "origin": "ia"})["id"]
        assert jid >= 1_000_000
        j = wait_done(url, jid)
        assert j["state"] == "done" and j["result"]["path"].endswith(".png") and j["origin"] == "ia"
        assert j["stages"]["sample"]["status"] == "end"
        # Le fichier produit est servi, et uniquement sous le dossier de sortie.
        with urllib.request.urlopen(f"{url}/files?path={j['result']['path']}") as f:
            assert f.read(8) == b"\x89PNG\r\n\x1a\n"
        try:
            urllib.request.urlopen(f"{url}/files?path={sys.executable}")
            assert False, "fichier hors sortie servi"
        except urllib.error.HTTPError as e:
            assert e.code == 404
        # L'interface a vu la tâche de l'IA.
        events = [json.loads(l) for l in out.getvalue().splitlines()]
        assert any(e["event"] == "queued" and e["origin"] == "ia" for e in events)
        assert any(e["event"] == "done" and e["id"] == jid and e["origin"] == "ia" for e in events)
        # Annulation d'un job en attente.
        a = http(f"{url}/jobs", "POST", {"task": "t2v", "model": "mock", "prompt": "x", "width": 640, "height": 360, "seconds": 5, "steps": 300})["id"]
        b = http(f"{url}/jobs", "POST", {"task": "t2v", "model": "mock", "prompt": "y", "width": 64, "height": 64, "seconds": 1})["id"]
        assert http(f"{url}/jobs/{b}/cancel", "POST", {})["state"] == "cancelled"
        time.sleep(0.5)
        assert http(f"{url}/jobs/{a}/cancel", "POST", {})["state"] == "running"
        assert wait_done(url, a)["state"] == "cancelled"
        assert http(f"{url}/unload", "POST", {})["ok"]
    finally:
        engine.set_api(False)


def test_token_required(tmp_path):
    engine = Engine(Emitter(io.StringIO()))
    engine.probe([])
    url = engine.set_api(True, 0, "secret", str(tmp_path))["url"]
    try:
        try:
            urllib.request.urlopen(f"{url}/status")
            assert False
        except urllib.error.HTTPError as e:
            assert e.code == 401
        req = urllib.request.Request(f"{url}/status", headers={"X-Token": "secret"})
        assert urllib.request.urlopen(req).status == 200
    finally:
        engine.set_api(False)


def test_mcp_connector_over_stdio(image, tmp_path):
    engine = Engine(Emitter(io.StringIO()))
    engine.probe([])
    url = engine.set_api(True, 0, None, str(tmp_path))["url"]
    proc = subprocess.Popen([sys.executable, "-m", "videoarms.mcp", "--url", url], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        def rpc(id, method, params=None):
            proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": id, "method": method, "params": params or {}}) + "\n")
            proc.stdin.flush()
            return json.loads(proc.stdout.readline())

        init = rpc(1, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test"}})
        assert init["result"]["serverInfo"]["name"] == "screencomfy"
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        tools = rpc(2, "tools/list")["result"]["tools"]
        assert {t["name"] for t in tools} >= {"screencomfy_generate", "screencomfy_status", "screencomfy_models"}
        r = rpc(3, "tools/call", {"name": "screencomfy_generate", "arguments": {"task": "i2i", "model": "mock", "prompt": "plus chaud", "image": str(image), "width": 64, "height": 64}})
        payload = json.loads(r["result"]["content"][0]["text"])
        assert r["result"]["isError"] is False and payload["state"] == "done" and payload["result"]["kind"] == "image"
        r = rpc(4, "tools/call", {"name": "screencomfy_job", "arguments": {"id": payload["id"]}})
        assert json.loads(r["result"]["content"][0]["text"])["state"] == "done"
    finally:
        proc.stdin.close()
        proc.wait(timeout=10)
        engine.set_api(False)
