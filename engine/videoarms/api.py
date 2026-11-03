"""API HTTP locale : piloter ScreenComfy sans l'interface, depuis un script
ou une IA. Même moteur, même file que l'interface ; ce qu'une IA lance est
visible dans l'application.

  GET  /status                 machine, modèles, ComfyUI, modèle chargé, file
  GET  /models                 modèles et workflows utilisables
  POST /jobs                   {"task","model","prompt","image",…} → {"id"}
  GET  /jobs                   la file et les derniers résultats
  GET  /jobs/<id>              état, progression, résultat
  POST /jobs/<id>/cancel
  POST /load  {"model"}        charge un modèle · POST /unload
  POST /workflows/import {"path"}
  GET  /files?path=…           un fichier produit (sous le dossier de sortie)

Un jeton optionnel (`X-Token`) protège l'API si elle est exposée.
"""

from __future__ import annotations

import json
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .protocol import Emitter, Job, job_from_dict

API_ID_BASE = 1_000_000


class JobRecord:
    def __init__(self, id: int, job: Job, origin: str):
        self.id, self.job, self.origin = id, job, origin
        self.state = "waiting"           # waiting | running | done | error | cancelled
        self.stages: dict = {}
        self.progress: dict | None = None
        self.result: dict | None = None
        self.error: str | None = None
        self.created = time.time()
        self.finished: float | None = None

    def to_dict(self) -> dict:
        return {"id": self.id, "origin": self.origin, "state": self.state, "task": self.job.task, "model": self.job.model,
                "prompt": self.job.prompt, "stages": self.stages, "progress": self.progress, "result": self.result,
                "error": self.error, "created": self.created, "finished": self.finished}


class _JobEmitter(Emitter):
    """Enregistre les événements d'un job et les relaie à l'interface."""

    def __init__(self, parent: Emitter, rec: JobRecord):
        super().__init__(parent.out)
        self.lock = parent.lock
        self.parent, self.rec = parent, rec

    def emit(self, event, **data):
        if event == "stage":
            self.rec.stages[data["stage"]] = {"status": data["status"], "seconds": data.get("seconds"), "ok": data.get("ok", True)}
        elif event == "progress":
            self.rec.progress = {"step": data["step"], "total": data["total"], "seconds_per_step": data["seconds_per_step"]}
        data.setdefault("id", self.rec.id)
        data.setdefault("origin", self.rec.origin)
        self.parent.emit(event, **data)


class ApiServer:
    def __init__(self, engine, host: str = "127.0.0.1", port: int = 8765, token: str | None = None):
        self.engine = engine
        self.host, self.port, self.token = host, port, token
        self.jobs: dict[int, JobRecord] = {}
        self.queue: list[int] = []
        self.next_id = API_ID_BASE
        self.cv = threading.Condition()
        self.httpd: ThreadingHTTPServer | None = None
        self.worker: threading.Thread | None = None
        self.stopping = False
        # L'émetteur de l'interface, même quand un job a temporairement pris sa place.
        self.root = engine.em

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"

    # ---- cycle de vie
    def start(self) -> None:
        api = self

        class H(BaseHTTPRequestHandler):
            def _send(self, obj, code=200):
                b = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(b)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b)

            def _auth(self) -> bool:
                if api.token and self.headers.get("X-Token") != api.token:
                    self._send({"error": "jeton manquant ou invalide"}, 401)
                    return False
                return True

            def do_GET(self):
                if not self._auth():
                    return
                try:
                    u = urlparse(self.path)
                    if u.path == "/files":
                        return self._file(parse_qs(u.query).get("path", [""])[0])
                    self._send(api.route("GET", u.path, {}))
                except KeyError as e:
                    self._send({"error": str(e)}, 404)
                except Exception as e:
                    self._send({"error": str(e)}, 400)

            def do_POST(self):
                if not self._auth():
                    return
                try:
                    n = int(self.headers.get("Content-Length", 0))
                    body = json.loads(self.rfile.read(n) or b"{}")
                    self._send(api.route("POST", urlparse(self.path).path, body))
                except KeyError as e:
                    self._send({"error": str(e)}, 404)
                except Exception as e:
                    self._send({"error": str(e), "trace": traceback.format_exc()}, 400)

            def _file(self, path: str):
                import os

                p = Path(path)
                norm = lambda x: os.path.normcase(str(Path(x).resolve()))
                allowed = {norm(r.job.out_dir) for r in api.jobs.values()}
                if not p.is_file() or not any(norm(p).startswith(a + os.sep) or norm(p) == a for a in allowed):
                    return self._send({"error": "fichier inconnu"}, 404)
                import mimetypes

                data = p.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", mimetypes.guess_type(p.name)[0] or "application/octet-stream")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        self.httpd = ThreadingHTTPServer((self.host, self.port), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.worker = threading.Thread(target=self._work, daemon=True)
        self.worker.start()

    def stop(self) -> None:
        self.stopping = True
        with self.cv:
            self.cv.notify_all()
        if self.httpd:
            self.httpd.shutdown()
            self.httpd = None

    # ---- file
    def submit(self, job: Job, origin: str = "api") -> JobRecord:
        with self.cv:
            rec = JobRecord(self.next_id, job, origin)
            self.next_id += 1
            self.jobs[rec.id] = rec
            self.queue.append(rec.id)
            self.cv.notify()
        self.root.emit("queued", id=rec.id, origin=origin, task=job.task, model=job.model, prompt=job.prompt)
        return rec

    def _work(self) -> None:
        while not self.stopping:
            with self.cv:
                while not self.queue and not self.stopping:
                    self.cv.wait(1)
                if self.stopping:
                    return
                rec = self.jobs[self.queue.pop(0)]
            if rec.state == "cancelled":
                continue
            rec.state = "running"
            em = _JobEmitter(self.root, rec)
            try:
                with self.engine.lock:
                    self.engine.em, saved = em, self.engine.em
                    try:
                        rec.result = self.engine.generate(rec.job)
                    finally:
                        self.engine.em = saved
                rec.state = "done"
                em.emit("done", **rec.result)
            except Exception as e:
                from .backends import Cancelled

                if isinstance(e, Cancelled):
                    rec.state = "cancelled"
                    em.emit("cancelled")
                else:
                    rec.state, rec.error = "error", f"{type(e).__name__}: {e}"
                    em.emit("error", message=rec.error, trace=traceback.format_exc())
            rec.finished = time.time()

    # ---- routes
    def route(self, method: str, path: str, body: dict) -> dict:
        e = self.engine
        parts = [p for p in path.split("/") if p]
        if method == "GET" and parts == []:
            return {"app": "ScreenComfy", "api": "1", "doc": __doc__.strip().splitlines()[0]}
        if method == "GET" and parts == ["status"]:
            running = [r for r in self.jobs.values() if r.state == "running"]
            return {"machine": e.machine.to_dict(), "loaded": e.loaded.to_dict() if e.loaded else None, "auto_load": e.auto_load,
                    "comfy": e.comfy.status(), "queue": [self.jobs[i].to_dict() for i in self.queue], "running": [r.to_dict() for r in running],
                    "models": [m.to_dict() for m in e.models if m.supported]}
        if method == "GET" and parts == ["models"]:
            return {"models": [m.to_dict() for m in e.models]}
        if method == "GET" and parts == ["jobs"]:
            recent = sorted(self.jobs.values(), key=lambda r: r.created, reverse=True)[:50]
            return {"jobs": [r.to_dict() for r in recent]}
        if method == "GET" and len(parts) == 2 and parts[0] == "jobs":
            return self.jobs[int(parts[1])].to_dict()
        if method == "POST" and parts == ["jobs"]:
            if "task" not in body or "model" not in body:
                raise ValueError("task et model sont obligatoires")
            body.setdefault("prompt", "")
            body.setdefault("out_dir", self.default_out_dir)
            job = job_from_dict(body)
            if job.task not in ("i2v", "t2v", "t2i", "i2i", "i23d", "t23d", "t2a", "i2a"):
                raise ValueError(f"tâche inconnue : {job.task}")
            return {"id": self.submit(job, body.get("origin", "api")).id}
        if method == "POST" and len(parts) == 3 and parts[0] == "jobs" and parts[2] == "cancel":
            rec = self.jobs[int(parts[1])]
            if rec.state == "waiting":
                rec.state = "cancelled"
                with self.cv:
                    if rec.id in self.queue:
                        self.queue.remove(rec.id)
            elif rec.state == "running":
                e.cancel.set()
            return {"ok": True, "state": rec.state}
        if method == "POST" and parts == ["load"]:
            with e.lock:
                r = e.load(body["model"])
            self.root.emit("loaded", id=-1, **r)
            return r
        if method == "POST" and parts == ["unload"]:
            with e.lock:
                e.unload()
            self.root.emit("unloaded", id=-1)
            return {"ok": True}
        if method == "POST" and parts == ["policy"]:
            e.auto_load = bool(body.get("auto_load", True))
            self.root.emit("policy", auto_load=e.auto_load)
            return {"auto_load": e.auto_load}
        if method == "POST" and parts == ["workflows", "import"]:
            r = e.import_workflow(body["path"])
            self.root.emit("workflow", **r)
            return r
        raise KeyError(f"route inconnue : {method} {path}")

    default_out_dir = "sorties"


def main(argv=None) -> int:
    """Headless : `python -m videoarms.api --port 8765 --paths D:\\modeles --comfy-dir C:\\ComfyUI`."""
    import argparse
    import sys

    from .server import Engine

    p = argparse.ArgumentParser(prog="videoarms.api", description="ScreenComfy sans interface : API HTTP locale")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--token", help="jeton exigé dans l'en-tête X-Token")
    p.add_argument("--paths", nargs="*", default=[], help="dossiers de modèles")
    p.add_argument("--workflows", help="dossier des workflows ComfyUI")
    p.add_argument("--comfy-dir")
    p.add_argument("--comfy-port", type=int, default=8188)
    p.add_argument("--out", default="sorties")
    a = p.parse_args(argv)

    class Quiet(Emitter):
        def emit(self, event, **data):
            if event in ("stage", "done", "error", "log", "queued"):
                print(json.dumps({"event": event, **data}, ensure_ascii=False, default=str), file=sys.stderr)

    engine = Engine(Quiet())
    engine.probe(a.paths, {"dir": a.comfy_dir, "port": a.comfy_port}, a.workflows)
    api = ApiServer(engine, a.host, a.port, a.token)
    api.default_out_dir = a.out
    api.start()
    print(f"ScreenComfy API : {api.url}  ({len([m for m in engine.models if m.supported])} modèles)  Ctrl+C pour arrêter", file=sys.stderr)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        api.stop()
        engine.comfy.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
