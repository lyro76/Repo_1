import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { circle } from "../engine/draw";

export const halo: ModuleDef = {
  id: "halo", name: "Halo", regions: ["prefrontal", "parietal"], duration: 60, scored: true,
  tagline: "Attention soutenue : garde le doigt sur la lueur.",
  hint: "Garde le doigt sur la lueur qui dérive. Ignore les flashs sur les bords.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, pointer, css } = env;
    let x = 0.5, y = 0.5, vx = 0.05, vy = 0.03, held = 0, best = 0, flash = 0, fx = 0, fy = 0, speed = 1, inside = 0, total = 0;
    return {
      frame(dt, now) {
        const W = env.W, H = env.H;
        vx += (Math.sin(now * 0.7) * 0.02 + (Math.random() - 0.5) * 0.02) * dt * 10; vy += (Math.cos(now * 0.9) * 0.02 + (Math.random() - 0.5) * 0.02) * dt * 10;
        const sp = Math.hypot(vx, vy), max = 0.09 * speed; if (sp > max) { vx *= max / sp; vy *= max / sp; }
        x += vx * dt; y += vy * dt; if (x < 0.15 || x > 0.85) vx *= -1; if (y < 0.15 || y > 0.85) vy *= -1;
        x = Math.min(0.85, Math.max(0.15, x)); y = Math.min(0.85, Math.max(0.15, y));
        const px = x * W, py = y * H, rad = Math.min(W, H) * 0.09;
        const on = pointer.down && Math.hypot(pointer.x - px, pointer.y - py) < rad * 1.3;
        total += dt; if (on) { held += dt; inside += dt; best = Math.max(best, held); speed = Math.min(2.2, 1 + held / 15); } else { held = 0; speed = Math.max(1, speed - dt); }
        if (flash <= 0 && Math.random() < dt * 0.35) { flash = 0.5; const side = Math.floor(Math.random() * 4); fx = side === 0 ? 0.08 : side === 1 ? 0.92 : Math.random(); fy = side === 2 ? 0.08 : side === 3 ? 0.92 : Math.random(); }
        if (flash > 0) { flash -= dt; ctx.fillStyle = css("--accent-2"); ctx.globalAlpha = flash * 1.6; circle(ctx, fx * W, fy * H, rad * 0.6); ctx.fill(); ctx.globalAlpha = 1; }
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad * 2); g.addColorStop(0, css("--accent")); g.addColorStop(0.4, css("--glow")); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; circle(ctx, px, py, rad * 2); ctx.fill();
        ctx.strokeStyle = on ? css("--accent") : css("--muted"); ctx.lineWidth = on ? 3 : 1.5; circle(ctx, px, py, rad); ctx.stroke();
        if (pointer.down) { ctx.fillStyle = css("--fg"); ctx.globalAlpha = 0.35; circle(ctx, pointer.x, pointer.y, 10); ctx.fill(); ctx.globalAlpha = 1; }
      },
      status: () => `${held.toFixed(1)} s · record ${best.toFixed(1)} s`,
      result: () => ({ score: clamp100((100 * inside) / Math.max(1, total)), metric: Math.round(best * 10) / 10, label: "s sans décrocher" }),
    };
  },
};
