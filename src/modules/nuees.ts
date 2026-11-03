import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { circle } from "../engine/draw";

export const nuees: ModuleDef = {
  id: "nuees", name: "Nuées", regions: ["parietal"], duration: 60, scored: true,
  tagline: "Sens du nombre : quel côté a le plus de points ?",
  hint: "Touche le côté qui a le plus de points, sans compter.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env; type D = { x: number; y: number; r: number };
    let L: D[] = [], R: D[] = [], more = 0, ratio = 1.6, ok = 0, total = 0, minRatio = 1.6;
    const cloud = (n: number) => Array.from({ length: n }, () => ({ x: 0.1 + Math.random() * 0.8, y: 0.12 + Math.random() * 0.76, r: 2 + Math.random() * 3 }));
    const gen = () => { const n = 8 + Math.floor(Math.random() * 10), m = Math.round(n * ratio); more = Math.random() < 0.5 ? 0 : 1; L = cloud(more === 0 ? m : n); R = cloud(more === 1 ? m : n); };
    gen();
    return {
      down(p) { const pick = p.x < env.W / 2 ? 0 : 1; total++; if (pick === more) { ok++; ratio = Math.max(1.08, ratio - 0.05); minRatio = Math.min(minRatio, ratio); env.audio.tick(); } else { ratio = Math.min(2, ratio + 0.1); env.audio.bad(); } gen(); },
      frame() { const W = env.W, H = env.H; ctx.strokeStyle = css("--line"); ctx.beginPath(); ctx.moveTo(W / 2, H * 0.05); ctx.lineTo(W / 2, H * 0.95); ctx.stroke();
        ctx.fillStyle = css("--accent"); for (const d of L) { circle(ctx, (d.x * W) / 2, d.y * H, d.r); ctx.fill(); }
        ctx.fillStyle = css("--accent-2"); for (const d of R) { circle(ctx, W / 2 + (d.x * W) / 2, d.y * H, d.r); ctx.fill(); } },
      status: () => `${ok}/${total} · ratio ${ratio.toFixed(2)}`,
      result: () => ({ score: clamp100(((2 - minRatio) / 0.92) * 100), metric: Math.round(minRatio * 100) / 100, label: "ratio le plus fin" }),
    };
  },
};
