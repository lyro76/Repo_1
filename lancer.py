#!/usr/bin/env python3
"""
Lanceur de ClipStudio — nécessite seulement Python 3.8+ (aucune installation).

Sert l'application déjà compilée (dossier « dist ») sur http://localhost:5173
avec les en-têtes COOP/COEP requis par l'export MP4, puis ouvre le navigateur.

Utilisation :  python lancer.py        (ou double-clic sur lancer.bat sous Windows)
Arrêt :        Ctrl+C dans la fenêtre
"""
from __future__ import annotations

import errno
import functools
import http.server
import os
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

PORT = 5173  # même port que « npm run dev » : les projets enregistrés sont partagés
HOST = "localhost"
ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"

# Types MIME explicites : sous Windows, le registre peut associer .js à text/plain,
# ce qui empêcherait le navigateur d'exécuter l'application.
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".map": "application/json",
    "": "application/octet-stream",
}


def say(message: str = "") -> None:
    """Affiche un message même si la console ne gère pas les accents."""
    try:
        print(message, flush=True)
    except UnicodeEncodeError:
        print(message.encode("ascii", "replace").decode("ascii"), flush=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = MIME_TYPES

    def end_headers(self) -> None:
        # Isolation cross-origin : nécessaire pour ffmpeg.wasm (export MP4).
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        if self.path in ("/", "/index.html"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass  # pas de journal de chaque requête


def find_browser() -> list[str] | None:
    """Chrome ou Edge (navigateurs pris en charge), sinon None."""
    candidates: list[str] = []
    if sys.platform.startswith("win"):
        for env in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            base = os.environ.get(env)
            if base:
                candidates.append(os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
                candidates.append(os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
    elif sys.platform == "darwin":
        candidates += [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
    else:
        for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"):
            found = shutil.which(name)
            if found:
                candidates.append(found)
    for path in candidates:
        if os.path.isfile(path):
            return [path]
    return None


def open_browser(url: str) -> None:
    browser = find_browser()
    try:
        if browser:
            subprocess.Popen(browser + [url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
    except OSError:
        pass
    webbrowser.open(url)


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def main() -> int:
    url = f"http://{HOST}:{PORT}/"
    no_browser = "--no-browser" in sys.argv

    if sys.version_info < (3, 8):
        say("Python 3.8 ou plus récent est nécessaire : https://www.python.org/downloads/")
        return 1

    if not (DIST / "index.html").is_file():
        say("Le dossier « dist » est introuvable à côté de lancer.py.")
        say("Récupérez la dernière version du projet (git pull) ou, avec Node.js : npm install puis npm run build.")
        return 1

    if not (DIST / "ffmpeg" / "ffmpeg-core.wasm").is_file():
        say("Attention : le moteur MP4 (dist/ffmpeg) est absent. L'export WebM fonctionnera, pas l'export MP4.")

    if port_in_use(PORT):
        say(f"Le port {PORT} est déjà utilisé : ClipStudio est sans doute déjà lancé.")
        say(f"Ouverture de {url}")
        if not no_browser:
            open_browser(url)
        return 0

    handler = functools.partial(Handler, directory=str(DIST))
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    except OSError as error:
        if error.errno in (errno.EADDRINUSE, 10048):
            say(f"Impossible d'utiliser le port {PORT} : il est occupé par un autre programme.")
        else:
            say(f"Impossible de démarrer le serveur : {error}")
        return 1

    say("")
    say("  ClipStudio est lancé !")
    say(f"  Ouvrez {url} dans Chrome ou Edge.")
    say("  Laissez cette fenêtre ouverte pendant l'utilisation.")
    say("  Pour arrêter : Ctrl+C (ou fermez cette fenêtre).")
    say("")

    if not no_browser:
        threading.Timer(0.6, open_browser, args=(url,)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        say("\nClipStudio est arrêté.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
