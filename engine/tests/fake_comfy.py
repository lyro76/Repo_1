"""Un faux serveur ComfyUI : juste assez pour tester le client (sans websocket → sondage)."""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

NODES = ["LoadImage", "CLIPTextEncode", "KSampler", "EmptyLTXVLatentVideo", "SaveVideo", "VAEDecode", "CheckpointLoaderSimple", "SaveAudio", "SaveGLB"]


class FakeComfy:
    def __init__(self, missing: list[str] | None = None, outputs=None, vram_total_mb: int = 10240, vram_free_mb: int = 9000):
        self.vram_total_mb, self.vram_free_mb = vram_total_mb, vram_free_mb
        self.received: list[dict] = []
        self.uploads: list[str] = []
        self.missing = set(missing or [])
        self.outputs = outputs or {"9": {"gifs": [{"filename": "out.mp4", "subfolder": "", "type": "output"}]}}
        server = self

        class H(BaseHTTPRequestHandler):
            def _json(self, obj, code=200):
                b = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def do_GET(self):
                u = urlparse(self.path)
                if u.path == "/system_stats":
                    # Pendant un job, la VRAM libre baisse.
                    busy = server.received and time.time() - server.received[-1]["t"] < 0.3
                    free = server.vram_free_mb - (6000 if busy else 0)
                    return self._json({"system": {"comfyui_version": "0.9.9"}, "devices": [{"name": "fake GPU", "type": "cuda", "vram_total": server.vram_total_mb * 1024 * 1024, "vram_free": free * 1024 * 1024}]})
                if u.path == "/object_info":
                    return self._json({n: {} for n in NODES if n not in server.missing})
                if u.path.startswith("/history/"):
                    pid = u.path.rsplit("/", 1)[1]
                    done = time.time() - server.received[-1]["t"] > 0.3 if server.received else False
                    return self._json({pid: {"outputs": server.outputs, "status": {"completed": True, "status_str": "success"}}} if done else {})
                if u.path == "/view":
                    q = parse_qs(u.query)
                    b = f"FAKE:{q['filename'][0]}".encode()
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(b)))
                    self.end_headers()
                    return self.wfile.write(b)
                self._json({"error": "?"}, 404)

            def do_POST(self):
                n = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(n)
                if self.path == "/upload/image":
                    name = body.split(b'filename="')[1].split(b'"')[0].decode()
                    server.uploads.append(name)
                    return self._json({"name": name, "subfolder": "", "type": "input"})
                if self.path == "/prompt":
                    wf = json.loads(body)["prompt"]
                    bad = [c for c in {v["class_type"] for v in wf.values()} if c in server.missing]
                    if bad:
                        return self._json({"error": {"message": "invalid prompt"}, "node_errors": {"1": {"class_type": bad[0], "errors": [{"message": "nœud inconnu"}]}}}, 400)
                    server.received.append({"wf": wf, "t": time.time()})
                    return self._json({"prompt_id": f"p{len(server.received)}", "number": 1})
                if self.path in ("/free", "/interrupt"):
                    return self._json({})
                self._json({}, 404)

            def log_message(self, *a):
                pass

        self.httpd = HTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()
