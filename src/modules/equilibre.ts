import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { circle } from "../engine/draw";

export const equilibre: ModuleDef = {
  id: "equilibre", name: "Équilibre", regions: ["cervelet"], duration: 60, scored: true,
  tagline: "Garde la bille au centre avec des gestes doux.",
  hint: "Glisse doucement pour garder la bille au centre malgré le vent.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env;
    let tilt = 0, target = 0, bx = 0, bv = 0, wind = 0, calm = 0, best = 0, jerk = 0, lastPx: number | null = null, centeredT = 0, total = 0;
    return {
      down(p) { lastPx = p.x; },
      drag(p) { if (lastPx === null) return; const dx = (p.x - lastPx) / env.W; lastPx = p.x; target = Math.max(-0.5, Math.min(0.5, target + dx * 2.2)); jerk = jerk * 0.9 + Math.abs(dx) * 40; },
      up() { lastPx = null; },
      frame(dt, now) {
        const W = env.W, H = env.H;
        wind = Math.sin(now * 0.5) * 0.6 + Math.sin(now * 1.7) * 0.3;
        tilt += (target - tilt) * Math.min(1, dt * 8); target *= 1 - dt * 0.4;
        bv += (Math.sin(tilt) * 9 + wind * 0.45 - bv * 0.8) * dt; bx += bv * dt;
        if (Math.abs(bx) > 1) { bx = Math.sign(bx) * 0.95; bv = 0; calm = 0; target = 0; env.audio.bad(); }
        const centered = Math.abs(bx) < 0.25 && jerk < 1.5; total += dt; if (centered) { calm += dt; centeredT += dt; } else calm = 0; best = Math.max(best, calm); jerk *= 1 - dt * 2;
        const cx = W / 2, cy = H * 0.62, L = W * 0.38;
        ctx.strokeStyle = css("--accent-2"); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
        for (let i = 0; i < 5; i++) { const y = H * 0.15 + i * H * 0.08, x0 = (((now * 60 * (1 + i * 0.2) * Math.sign(wind || 1)) % W) + W) % W; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + wind * 60, y + 2); ctx.stroke(); }
        ctx.globalAlpha = 1; ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilt);
        ctx.strokeStyle = css("--fg"); ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L, 0); ctx.stroke();
        const r = W * 0.035; ctx.fillStyle = centered ? css("--accent") : css("--accent-2"); circle(ctx, bx * L, -r - 3, r); ctx.fill(); ctx.restore();
        ctx.fillStyle = css("--fg"); ctx.beginPath(); ctx.moveTo(cx - 14, H * 0.85); ctx.lineTo(cx + 14, H * 0.85); ctx.lineTo(cx, cy + 4); ctx.closePath(); ctx.fill();
      },
      status: () => `${calm.toFixed(1)} s calme · record ${best.toFixed(1)} s`,
      result: () => ({ score: clamp100((100 * centeredT) / Math.max(1, total)), metric: Math.round(best * 10) / 10, label: "s de calme d'affilée" }),
    };
  },
};
