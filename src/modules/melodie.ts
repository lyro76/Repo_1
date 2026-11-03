import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { label, roundRect } from "../engine/draw";

export const melodie: ModuleDef = {
  id: "melodie", name: "Mélodie", regions: ["temporal"], duration: 90, scored: true,
  tagline: "Rejoue la suite de notes, qui s'allonge.",
  hint: "Écoute la suite de notes, puis rejoue-la.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env; const freqs = [261.6, 329.6, 392, 523.3]; let seq: number[] = [], idx = 0, playing = false, lit = -1, litT = 0, best = 0, queue: number[] = [], started = false;
    const tone = (i: number) => { env.audio.tone(freqs[i], 0.4, 0.25); lit = i; litT = 0.3; };
    const play = () => { playing = true; queue = seq.slice(); litT = 0.2; };
    const start = () => { started = true; seq = [Math.floor(Math.random() * 4)]; idx = 0; play(); };
    return {
      down(p) { if (playing) return; if (!started || !seq.length) { start(); return; } const i = (p.x < env.W / 2 ? 0 : 1) + (p.y < env.H / 2 ? 0 : 2); tone(i);
        if (i === seq[idx]) { idx++; if (idx === seq.length) { best = Math.max(best, seq.length); seq.push(Math.floor(Math.random() * 4)); idx = 0; setTimeout(play, 600); } } else { env.audio.bad(); seq = []; idx = 0; setTimeout(start, 700); } },
      frame(dt) { const W = env.W, H = env.H; litT -= dt; if (litT <= 0) lit = -1; if (playing && litT <= -0.15) { if (queue.length) tone(queue.shift()!); else playing = false; }
        for (let i = 0; i < 4; i++) { const x = (i % 2) * (W / 2), y = Math.floor(i / 2) * (H / 2); ctx.fillStyle = i === lit ? css("--accent") : css("--surface"); ctx.strokeStyle = css("--line"); roundRect(ctx, x + 8, y + 8, W / 2 - 16, H / 2 - 16, 14); ctx.fill(); ctx.stroke(); }
        if (!started) label(ctx, "toucher pour commencer", W / 2, H / 2, Math.min(W * 0.05, 20), css("--muted"), 600); },
      status: () => `suite ${seq.length} · record ${best}`,
      result: () => ({ score: clamp100(best * 11), metric: best, label: "notes mémorisées" }),
    };
  },
};
