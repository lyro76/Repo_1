"""Connecteur MCP (Model Context Protocol) : une IA pilote ScreenComfy
comme un jeu d'outils. Transport stdio, JSON-RPC 2.0, sans dépendance.

Côté IA (Claude Desktop, Claude Code, autres) :
    claude mcp add screencomfy -- <python> -m videoarms.mcp --url http://127.0.0.1:8765

Le connecteur parle à l'API HTTP de l'app (ou de `videoarms.api` en headless).
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

TOOLS = [
    {"name": "screencomfy_status", "description": "État de ScreenComfy : machine (GPU, VRAM), modèle chargé, ComfyUI, file d'attente, modèles disponibles.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "screencomfy_models", "description": "Liste les modèles et workflows utilisables, avec leurs tâches (i2v, t2v, t2i, i2i, i23d, t23d, t2a).",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "screencomfy_generate",
     "description": "Lance une génération : vidéo (i2v image→vidéo, t2v prompt→vidéo), image (t2i, i2i), 3D (i23d, t23d), audio (t2a). Renvoie l'id du job ; avec wait=true, attend la fin et renvoie le fichier produit.",
     "inputSchema": {"type": "object", "required": ["task", "model", "prompt"], "properties": {
         "task": {"type": "string", "enum": ["i2v", "t2v", "t2i", "i2i", "i23d", "t23d", "t2a", "i2a"]},
         "model": {"type": "string", "description": "id de modèle (voir screencomfy_models)"},
         "prompt": {"type": "string"}, "negative_prompt": {"type": "string"},
         "image": {"type": "string", "description": "chemin de l'image d'entrée (tâches i2*)"},
         "width": {"type": "integer"}, "height": {"type": "integer"}, "seconds": {"type": "number"}, "fps": {"type": "number"},
         "steps": {"type": "integer"}, "guidance": {"type": "number"}, "seed": {"type": "integer"}, "strength": {"type": "number"},
         "audio": {"type": "boolean"}, "mode": {"type": "string", "enum": ["draft", "final"]},
         "out_dir": {"type": "string"}, "name": {"type": "string"},
         "wait": {"type": "boolean", "description": "attendre la fin (par défaut true)"},
         "timeout": {"type": "number", "description": "secondes d'attente max (défaut 1800)"}}}},
    {"name": "screencomfy_job", "description": "État, progression et résultat d'un job.",
     "inputSchema": {"type": "object", "required": ["id"], "properties": {"id": {"type": "integer"}}}},
    {"name": "screencomfy_cancel", "description": "Annule un job.", "inputSchema": {"type": "object", "required": ["id"], "properties": {"id": {"type": "integer"}}}},
    {"name": "screencomfy_load", "description": "Charge un modèle en mémoire.", "inputSchema": {"type": "object", "required": ["model"], "properties": {"model": {"type": "string"}}}},
    {"name": "screencomfy_unload", "description": "Décharge le modèle courant (libère la VRAM).", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "screencomfy_import_workflow", "description": "Importe un workflow ComfyUI (format API) pour en faire une tâche.",
     "inputSchema": {"type": "object", "required": ["path"], "properties": {"path": {"type": "string"}}}},
]


class Client:
    def __init__(self, url: str, token: str | None = None):
        self.url, self.token = url.rstrip("/"), token

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, method=method, headers={"Content-Type": "application/json", **({"X-Token": self.token} if self.token else {})})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                return {"error": json.loads(e.read().decode())["error"]}
            except Exception:
                return {"error": f"HTTP {e.code}"}
        except urllib.error.URLError as e:
            return {"error": f"ScreenComfy injoignable ({self.url}) : lance l'app avec « Pilotage par une IA » activé, ou `python -m videoarms.api` ({e.reason})"}

    def tool(self, name: str, args: dict) -> dict:
        if name == "screencomfy_status":
            return self.call("GET", "/status")
        if name == "screencomfy_models":
            return self.call("GET", "/models")
        if name == "screencomfy_job":
            return self.call("GET", f"/jobs/{int(args['id'])}")
        if name == "screencomfy_cancel":
            return self.call("POST", f"/jobs/{int(args['id'])}/cancel", {})
        if name == "screencomfy_load":
            return self.call("POST", "/load", {"model": args["model"]})
        if name == "screencomfy_unload":
            return self.call("POST", "/unload", {})
        if name == "screencomfy_import_workflow":
            return self.call("POST", "/workflows/import", {"path": args["path"]})
        if name == "screencomfy_generate":
            wait = args.pop("wait", True)
            timeout = float(args.pop("timeout", 1800))
            args["origin"] = "ia"
            r = self.call("POST", "/jobs", args)
            if "error" in r or not wait:
                return r
            jid = r["id"]
            t0 = time.time()
            while time.time() - t0 < timeout:
                j = self.call("GET", f"/jobs/{jid}")
                if j.get("state") in ("done", "error", "cancelled"):
                    return j
                time.sleep(1.0)
            return {"id": jid, "state": "running", "note": "toujours en cours : interroge screencomfy_job"}
        return {"error": f"outil inconnu : {name}"}


def serve(url: str, token: str | None = None, stdin=None, stdout=None) -> None:
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    client = Client(url, token)

    def send(obj):
        stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        stdout.flush()

    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        mid, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
        if method == "initialize":
            send({"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": params.get("protocolVersion", "2025-06-18"),
                  "capabilities": {"tools": {}}, "serverInfo": {"name": "screencomfy", "version": "0.1.0"}}})
        elif method == "notifications/initialized" or mid is None:
            continue
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": mid, "result": {}})
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}})
        elif method == "tools/call":
            name, args = params.get("name"), dict(params.get("arguments") or {})
            r = client.tool(name, args)
            send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": json.dumps(r, ensure_ascii=False, indent=1)}], "isError": bool(r.get("error"))}})
        else:
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"méthode inconnue : {method}"}})


def main(argv=None) -> int:
    import argparse

    p = argparse.ArgumentParser(prog="videoarms.mcp")
    p.add_argument("--url", default="http://127.0.0.1:8765")
    p.add_argument("--token")
    a = p.parse_args(argv)
    serve(a.url, a.token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
