"""Lancer, trouver et interroger un serveur ComfyUI."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def find_comfy_python(comfy_dir: Path) -> Path | None:
    """L'interpréteur de l'installation ComfyUI : venv, .venv, ou python_embeded (portable)."""
    exe = "python.exe" if sys.platform == "win32" else "python"
    bin_dir = "Scripts" if sys.platform == "win32" else "bin"
    for cand in [comfy_dir / "venv" / bin_dir / exe, comfy_dir / ".venv" / bin_dir / exe,
                 comfy_dir.parent / "python_embeded" / "python.exe", comfy_dir / "python_embeded" / "python.exe"]:
        if cand.is_file():
            return cand
    return None


def comfy_version(comfy_dir: Path) -> str | None:
    try:
        text = (comfy_dir / "comfyui_version.py").read_text(encoding="utf-8")
        for line in text.splitlines():
            if "__version__" in line and "=" in line:
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return None


class ComfyServer:
    def __init__(self, comfy_dir: str | None, python: str | None = None, port: int = 8188, host: str = "127.0.0.1"):
        self.dir = Path(comfy_dir).expanduser() if comfy_dir else None
        self.python = Path(python) if python else (find_comfy_python(self.dir) if self.dir else None)
        self.port = port
        self.host = host
        self.proc: subprocess.Popen | None = None
        self.external = False
        self._object_info: dict | None = None

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"

    # ---- état
    def get(self, path: str, timeout: float = 5) -> dict:
        with urllib.request.urlopen(f"{self.url}{path}", timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def post(self, path: str, body: dict, timeout: float = 30) -> dict:
        req = urllib.request.Request(f"{self.url}{path}", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "{}")

    def alive(self) -> bool:
        try:
            self.get("/system_stats", timeout=2)
            return True
        except Exception:
            return False

    def status(self) -> dict:
        found = bool(self.dir and (self.dir / "main.py").is_file())
        return {
            "dir": str(self.dir) if self.dir else None,
            "found": found,
            "python": str(self.python) if self.python else None,
            "version": comfy_version(self.dir) if found else None,
            "port": self.port,
            "running": self.alive(),
            "external": self.external,
            "custom_nodes": sorted(p.name for p in (self.dir / "custom_nodes").iterdir() if p.is_dir() and not p.name.startswith(".")) if found and (self.dir / "custom_nodes").is_dir() else [],
        }

    # ---- vie du processus
    def start(self, log=None, timeout: float = 180) -> None:
        """Démarre ComfyUI sans fenêtre, ou adopte un serveur déjà en marche."""
        if self.alive():
            self.external = self.proc is None
            return
        if not self.dir or not (self.dir / "main.py").is_file():
            raise RuntimeError("dossier ComfyUI introuvable : indique-le dans les réglages")
        if not self.python:
            raise RuntimeError("interpréteur Python de ComfyUI introuvable (venv, .venv ou python_embeded) : indique-le dans les réglages")
        cmd = [str(self.python), "-s", "main.py", "--listen", self.host, "--port", str(self.port), "--disable-auto-launch"]
        kwargs: dict = {}
        if sys.platform == "win32":
            kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
        self.proc = subprocess.Popen(cmd, cwd=str(self.dir), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", **kwargs)
        self.external = False
        import threading

        def pump():
            for line in self.proc.stdout:  # type: ignore[union-attr]
                if log:
                    log(f"[comfyui] {line.rstrip()}")

        threading.Thread(target=pump, daemon=True).start()
        t0 = time.time()
        while time.time() - t0 < timeout:
            if self.proc.poll() is not None:
                raise RuntimeError(f"ComfyUI s'est arrêté au démarrage (code {self.proc.returncode}) — voir le journal")
            if self.alive():
                return
            time.sleep(0.5)
        raise RuntimeError(f"ComfyUI ne répond pas après {timeout:.0f} s")

    def stop(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None
        self._object_info = None

    # ---- nœuds
    def object_info(self, refresh: bool = False) -> dict:
        if self._object_info is None or refresh:
            self._object_info = self.get("/object_info", timeout=60)
        return self._object_info

    def missing_nodes(self, class_types: set[str]) -> list[str]:
        try:
            known = set(self.object_info())
        except Exception:
            return []
        return sorted(c for c in class_types if c not in known)

    # ---- fichiers
    def upload_image(self, path: Path) -> str:
        """Envoie une image dans `input/` et renvoie le nom à utiliser dans LoadImage."""
        import mimetypes
        import uuid

        boundary = uuid.uuid4().hex
        data = path.read_bytes()
        name = f"screencomfy_{uuid.uuid4().hex[:8]}{path.suffix.lower()}"
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\nContent-Type: {ctype}\r\n\r\n").encode() + data + \
               (f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{boundary}--\r\n").encode()
        req = urllib.request.Request(f"{self.url}/upload/image", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            info = json.loads(r.read().decode("utf-8"))
        sub = info.get("subfolder") or ""
        return f"{sub}/{info['name']}" if sub else info["name"]

    def download(self, item: dict, dest: Path) -> Path:
        from urllib.parse import urlencode

        q = urlencode({"filename": item["filename"], "subfolder": item.get("subfolder", ""), "type": item.get("type", "output")})
        with urllib.request.urlopen(f"{self.url}/view?{q}", timeout=600) as r:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(r.read())
        return dest

    # ---- exécution
    def submit(self, workflow: dict, client_id: str) -> str:
        try:
            r = self.post("/prompt", {"prompt": workflow, "client_id": client_id})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            try:
                d = json.loads(detail)
                msgs = [d.get("error", {}).get("message", "")] + [f"{v.get('class_type', k)} : {', '.join(x.get('message', '') for x in v.get('errors', []))}" for k, v in d.get("node_errors", {}).items()]
                detail = " ; ".join(m for m in msgs if m)
            except Exception:
                pass
            raise RuntimeError(f"ComfyUI a refusé le workflow : {detail}") from None
        if "prompt_id" not in r:
            raise RuntimeError(f"ComfyUI a refusé le workflow : {r}")
        return r["prompt_id"]

    def history(self, prompt_id: str) -> dict | None:
        h = self.get(f"/history/{prompt_id}", timeout=30)
        return h.get(prompt_id)

    def interrupt(self) -> None:
        try:
            self.post("/interrupt", {})
        except Exception:
            pass

    def wait(self, prompt_id: str, client_id: str, on_progress, cancel, poll: float = 0.5) -> dict:
        """Attend la fin d'un prompt. Progression par websocket si possible, sinon par sondage."""
        ws = None
        try:
            import websocket  # websocket-client

            ws = websocket.create_connection(f"ws://{self.host}:{self.port}/ws?clientId={client_id}", timeout=5)
            ws.settimeout(poll)
        except Exception:
            ws = None
        try:
            while True:
                if cancel.is_set():
                    self.interrupt()
                    raise InterruptedError()
                if ws is not None:
                    try:
                        raw = ws.recv()
                        if isinstance(raw, str):
                            msg = json.loads(raw)
                            t, d = msg.get("type"), msg.get("data", {})
                            if t == "progress" and d.get("prompt_id") in (None, prompt_id):
                                on_progress("progress", d.get("value", 0), d.get("max", 0), d.get("node"))
                            elif t == "executing" and d.get("prompt_id") == prompt_id:
                                on_progress("node", 0, 0, d.get("node"))
                                if d.get("node") is None:
                                    break
                            elif t == "execution_error" and d.get("prompt_id") == prompt_id:
                                raise RuntimeError(f"erreur dans le nœud {d.get('node_type')} : {d.get('exception_message')}")
                    except TimeoutError:
                        pass
                    except Exception as e:
                        if "timed out" not in str(e).lower():
                            ws = None
                else:
                    time.sleep(poll)
                h = self.history(prompt_id)
                if h and h.get("status", {}).get("completed") or (h and h.get("outputs") and h.get("status", {}).get("status_str") == "success"):
                    return h
                if h and h.get("status", {}).get("status_str") == "error":
                    msgs = [m for m in h["status"].get("messages", []) if m[0] == "execution_error"]
                    detail = msgs[0][1].get("exception_message") if msgs else "erreur d'exécution"
                    raise RuntimeError(f"ComfyUI : {detail}")
        finally:
            if ws is not None:
                try:
                    ws.close()
                except Exception:
                    pass


def outputs_of(history: dict) -> list[tuple[str, dict]]:
    """[(type, item)] pour chaque fichier produit : images, gifs/vidéos, audio, 3d."""
    out = []
    for node_out in history.get("outputs", {}).values():
        for key, items in node_out.items():
            if not isinstance(items, list):
                continue
            for it in items:
                if isinstance(it, dict) and "filename" in it:
                    out.append((key, it))
    return out


def kind_of_outputs(items: list[tuple[str, dict]]) -> str:
    for key, it in items:
        name = it["filename"].lower()
        if key in ("3d", "mesh") or name.endswith((".glb", ".gltf", ".obj", ".ply", ".fbx", ".stl")):
            return "3d"
        if key == "audio" or name.endswith((".mp3", ".wav", ".flac", ".ogg", ".opus")):
            return "audio"
        if key in ("gifs", "videos") or name.endswith((".mp4", ".webm", ".mov", ".gif")):
            return "video"
    return "image" if items else "video"
