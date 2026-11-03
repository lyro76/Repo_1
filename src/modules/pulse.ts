import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { label, circle } from "../engine/draw";

export const pulse: ModuleDef = {
  id: "pulse", name: "Pulse", regions: ["cervelet"], duration: 60, scored: true,
  tagline: "Tape en rythme, puis garde le tempo seul.",
  hint: "Tape avec le battement, puis continue seul quand il s'arrête.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env; const period = 0.6; let t = 0, taps: { t: number; dev: number }[] = [], devs: number[] = [], beat = -1, lastCycleAvg: number | null = null;
    return {
      down() { const k = Math.round(t / period); if (k < 2) return; const dev = (t - k * period) * 1000; devs.push(Math.abs(dev)); taps.push({ t, dev }); env.audio.tick(); },
      frame(dt, _now) { const W = env.W, H = env.H; t += dt; const k = Math.floor(t / period), ph = t / period - k; const audible = k < 8;
        if (k !== beat) { beat = k; if (audible) env.audio.tone(k % 4 === 0 ? 660 : 440, 0.1, 0.2, "triangle"); }
        if (k > 24) { lastCycleAvg = devs.length ? devs.reduce((a, b) => a + b) / devs.length : lastCycleAvg; t = 0; taps = []; devs = []; }
        const R = Math.min(W, H) * 0.18 * (audible ? 1 + 0.35 * Math.exp(-ph * 6) : 1); ctx.strokeStyle = audible ? css("--accent") : css("--muted"); ctx.lineWidth = audible ? 4 : 1.5; circle(ctx, W / 2, H * 0.42, R); ctx.stroke();
        if (!audible) label(ctx, "continue seul", W / 2, H * 0.42, W * 0.05, css("--muted"), 600);
        ctx.strokeStyle = css("--line"); ctx.beginPath(); ctx.moveTo(W * 0.1, H * 0.8); ctx.lineTo(W * 0.9, H * 0.8); ctx.stroke();
        for (const tp of taps.slice(-10)) { const x = W / 2 + (tp.dev / 300) * W * 0.4; ctx.fillStyle = Math.abs(tp.dev) < 60 ? css("--accent") : css("--accent-2"); circle(ctx, Math.max(W * 0.1, Math.min(W * 0.9, x)), H * 0.8, 5); ctx.fill(); } },
      status: () => { const avg = devs.length ? devs.reduce((a, b) => a + b) / devs.length : null; return avg !== null ? `écart moyen ${Math.round(avg)} ms` : `battement ${Math.min(8, Math.floor(t / period) + 1)}/8`; },
      result: () => { const all = devs.length ? devs.reduce((a, b) => a + b) / devs.length : lastCycleAvg ?? 300; return { score: clamp100(100 - all / 2.5), metric: Math.round(all), label: "ms d'écart moyen" }; },
    };
  },
};
