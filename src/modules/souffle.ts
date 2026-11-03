import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { label, circle } from "../engine/draw";

export const souffle: ModuleDef = {
  id: "souffle", name: "Souffle", regions: ["limbique"], duration: 60, scored: true,
  tagline: "Cohérence cardiaque : suis le cercle avec le doigt.",
  hint: "Pose le doigt pendant que le cercle grandit, relâche quand il rétrécit.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, pointer, css } = env;
    const half = env.breath ?? 5, period = half * 2;
    let t = 0, good = 0, total = 0, lastPhase = true;
    const parts = Array.from({ length: 48 }, (_, i) => ({ a: (i / 48) * Math.PI * 2, r: Math.random() }));
    return {
      frame(dt, now) {
        const W = env.W, H = env.H, cx = W / 2, cy = H / 2;
        t += dt; const ph = (t % period) / period, inhale = ph < 0.5;
        if (inhale !== lastPhase) { lastPhase = inhale; env.audio.tone(inhale ? 523 : 392, 0.3, 0.08); }
        const k = inhale ? ph * 2 : 1 - (ph - 0.5) * 2, e = 0.5 - 0.5 * Math.cos(k * Math.PI);
        const R = Math.min(W, H) * (0.14 + 0.24 * e);
        if (t > 1) { total += dt; if (pointer.down === inhale) good += dt; }
        const acc = css("--accent");
        for (const p of parts) { const rr = R * (1.25 + 0.35 * p.r) + Math.sin(now + p.a * 3) * 3; ctx.fillStyle = acc; ctx.globalAlpha = 0.25 + 0.3 * e; circle(ctx, cx + Math.cos(p.a) * rr, cy + Math.sin(p.a) * rr, 1.6); ctx.fill(); }
        ctx.globalAlpha = 1;
        const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R); g.addColorStop(0, acc); g.addColorStop(1, css("--glow"));
        ctx.fillStyle = g; circle(ctx, cx, cy, R); ctx.fill();
        ctx.strokeStyle = pointer.down ? css("--accent-2") : css("--muted"); ctx.lineWidth = 2; circle(ctx, cx, cy, Math.min(W, H) * 0.4); ctx.stroke();
        label(ctx, inhale ? "Inspire" : "Expire", cx, cy, Math.min(W, H) * 0.07, css("--fg"));
      },
      status: () => (total > 2 ? `${Math.round((100 * good) / total)} % en rythme` : `${half} s / ${half} s`),
      result: () => ({ score: clamp100((100 * good) / Math.max(1, total)), metric: Math.round((100 * good) / Math.max(1, total)), label: "% en rythme" }),
    };
  },
};
