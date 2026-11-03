import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { circle } from "../engine/draw";

export const mains: ModuleDef = {
  id: "mains", name: "Deux mains", regions: ["moteur", "cervelet"], duration: 60, scored: true,
  tagline: "Chaque pouce suit sa propre cible.",
  hint: "Deux doigts : chaque moitié suit sa propre cible.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css, pointers } = env; let both = 0, best = 0, total = 0, onT = 0;
    return {
      frame(dt, now) { const W = env.W, H = env.H; const ty = [0.5 + 0.32 * Math.sin(now * 1.1), 0.5 + 0.32 * Math.sin(now * 1.7 + 1)]; const on = [false, false];
        ctx.strokeStyle = css("--line"); ctx.beginPath(); ctx.moveTo(W / 2, H * 0.05); ctx.lineTo(W / 2, H * 0.95); ctx.stroke();
        for (let s = 0; s < 2; s++) { const cx = W * (0.25 + 0.5 * s), cy = ty[s] * H, r = Math.min(W, H) * 0.09; for (const f of pointers.values()) if ((f.x < W / 2) === (s === 0) && Math.hypot(f.x - cx, f.y - cy) < r * 1.4) on[s] = true;
          ctx.strokeStyle = on[s] ? css("--accent") : css("--muted"); ctx.lineWidth = on[s] ? 3 : 1.5; circle(ctx, cx, cy, r); ctx.stroke(); ctx.fillStyle = css("--glow"); circle(ctx, cx, cy, r); ctx.fill(); }
        for (const f of pointers.values()) { ctx.fillStyle = css("--fg"); ctx.globalAlpha = 0.35; circle(ctx, f.x, f.y, 10); ctx.fill(); ctx.globalAlpha = 1; }
        total += dt; if (on[0] && on[1]) { both += dt; onT += dt; best = Math.max(best, both); } else both = 0; },
      status: () => `${both.toFixed(1)} s à deux · record ${best.toFixed(1)} s`,
      result: () => ({ score: clamp100((100 * onT) / Math.max(1, total)), metric: Math.round(best * 10) / 10, label: "s à deux mains d'affilée" }),
    };
  },
};
