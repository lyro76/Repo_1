"""Usage en ligne de commande, sans l'application.

  python -m videoarms.cli probe  C:\\modeles
  python -m videoarms.cli gen --model mock --image photo.jpg --prompt "la caméra avance" --seconds 5 --out sorties
"""

from __future__ import annotations

import argparse
import json
import sys
import threading

from . import models as models_mod
from .protocol import Emitter, Job
from .server import Engine


class Pretty(Emitter):
    """Affichage lisible au lieu du JSON."""

    def emit(self, event, **data):
        if event == "stage" and data.get("status") == "start":
            print(f"  › {data['label']}", file=sys.stderr)
        elif event == "stage":
            print(f"    {'✓' if data.get('ok', True) else '✗'} {data.get('seconds', 0):.1f} s", file=sys.stderr)
        elif event == "progress":
            print(f"\r    pas {data['step']}/{data['total']} · {data['seconds_per_step']:.2f} s/pas", end="", file=sys.stderr)
            if data["step"] == data["total"]:
                print(file=sys.stderr)
        elif event == "log":
            print(f"    {data['text']}", file=sys.stderr)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="videoarms")
    sub = p.add_subparsers(dest="cmd", required=True)
    pr = sub.add_parser("probe", help="machine et modèles trouvés")
    pr.add_argument("paths", nargs="*")
    g = sub.add_parser("gen", help="génère une vidéo")
    g.add_argument("--model", required=True, help="id de modèle (voir probe) ou « mock »")
    g.add_argument("--paths", nargs="*", default=[], help="dossiers de modèles")
    g.add_argument("--image", required=True)
    g.add_argument("--prompt", required=True)
    g.add_argument("--negative", default=Job.negative_prompt)
    g.add_argument("--width", type=int, default=1280)
    g.add_argument("--height", type=int, default=720)
    g.add_argument("--seconds", type=float, default=5)
    g.add_argument("--fps", type=float, default=24)
    g.add_argument("--steps", type=int)
    g.add_argument("--guidance", type=float)
    g.add_argument("--seed", type=int)
    g.add_argument("--no-audio", action="store_true")
    g.add_argument("--memory", default="auto", choices=["auto", "gpu", "cpu_offload", "group_offload"])
    g.add_argument("--compile", action="store_true")
    g.add_argument("--sage", action="store_true")
    g.add_argument("--out", default="sorties")
    g.add_argument("--name", default="")
    g.add_argument("--post-fps", type=float, help="interpolation vers cette cadence (ffmpeg)")
    g.add_argument("--upscale", type=float, help="facteur d'agrandissement (ffmpeg lanczos)")
    a = p.parse_args(argv)

    em = Pretty()
    engine = Engine(em)
    if a.cmd == "probe":
        print(json.dumps(engine.probe(a.paths), indent=2, ensure_ascii=False))
        return 0
    engine.probe(a.paths)
    post = {k: v for k, v in {"fps": a.post_fps, "upscale": a.upscale}.items() if v}
    job = Job(model=a.model, image=a.image, prompt=a.prompt, negative_prompt=a.negative, width=a.width, height=a.height,
              seconds=a.seconds, fps=a.fps, steps=a.steps, guidance=a.guidance, seed=a.seed, audio=not a.no_audio,
              memory=a.memory, compile=a.compile, sage=a.sage, out_dir=a.out, name=a.name, post=post)
    try:
        res = engine.generate(job)
    except Exception as e:
        print(f"✗ {e}", file=sys.stderr)
        return 1
    t = res["timings"]
    print(f"✓ {res['path']}  ({res['frames']} images, {t['total']:.1f} s ; sampling {t['sample']:.1f} s, VAE {t['decode']:.1f} s, VRAM max {res['vram_peak_mb']} Mo)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
