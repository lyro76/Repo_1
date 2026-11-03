import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { roundRect } from "../engine/draw";

export const tours: ModuleDef = {
  id: "tours", name: "Tours", regions: ["prefrontal"], duration: 180, scored: true,
  tagline: "Tours de Hanoï : planifie avant de bouger.",
  hint: "Déplace les disques vers la tour de droite, jamais un grand sur un petit.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env; let N = 3, pegs: number[][] = [], hold = -1, from = -1, moves = 0, solved = 0, ratioSum = 0, holdX = 0, holdY = 0;
    const reset = () => { pegs = [Array.from({ length: N }, (_, i) => N - i), [], []]; moves = 0; hold = -1; };
    reset(); const pegAt = (x: number) => Math.min(2, Math.max(0, Math.floor(x / (env.W / 3))));
    return {
      down(p) { const k = pegAt(p.x); if (pegs[k].length) { hold = pegs[k].pop()!; from = k; holdX = p.x; holdY = p.y; } },
      drag(p) { holdX = p.x; holdY = p.y; },
      up(p) { if (hold < 0) return; const k = pegAt(p.x), top = pegs[k][pegs[k].length - 1]; if (top === undefined || top > hold) { pegs[k].push(hold); if (k !== from) { moves++; env.audio.tick(); } } else { pegs[from].push(hold); env.audio.bad(); } hold = -1;
        if (pegs[2].length === N) { solved++; ratioSum += (2 ** N - 1) / moves; env.audio.good(); N = Math.min(6, N + 1); reset(); } },
      frame() { const W = env.W, H = env.H, pw = W / 3, base = H * 0.82, dh = Math.min(H * 0.07, 34); ctx.strokeStyle = css("--line"); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W * 0.05, base); ctx.lineTo(W * 0.95, base); ctx.stroke();
        for (let k = 0; k < 3; k++) { const cx = pw * (k + 0.5); ctx.fillStyle = css("--muted"); roundRect(ctx, cx - 3, base - dh * (N + 1.5), 6, dh * (N + 1.5), 3); ctx.fill();
          pegs[k].forEach((d, i) => { const w = pw * (0.25 + (0.65 * d) / N); ctx.fillStyle = d === N ? css("--fg") : css("--accent"); roundRect(ctx, cx - w / 2, base - dh * (i + 1), w, dh - 4, 6); ctx.fill(); }); }
        if (hold >= 0) { const w = pw * (0.25 + (0.65 * hold) / N); ctx.fillStyle = css("--accent-2"); roundRect(ctx, holdX - w / 2, holdY - dh / 2, w, dh - 4, 6); ctx.fill(); } },
      status: () => `${N} disques · ${moves} coups · optimal ${2 ** N - 1} · ${solved} résolues`,
      result: () => ({ score: clamp100(solved ? (ratioSum / solved) * 60 + solved * 10 : moves ? 10 : 0), metric: solved, label: "tours résolues" }),
    };
  },
};
