import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100, pct } from "./types";
import { INK, label, roundRect } from "../engine/draw";

export const encre: ModuleDef = {
  id: "encre", name: "Encre", regions: ["cingulaire", "prefrontal"], duration: 60, scored: true,
  tagline: "Stroop : la couleur de l'encre, pas le mot.",
  hint: "Touche la couleur de l'encre, pas le mot.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env; const names = Object.keys(INK);
    let word = 0, ink = 1, ok = 0, total = 0, t0 = performance.now(), rt = 0, flash = 0;
    const next = () => { word = Math.floor(Math.random() * 4); ink = Math.random() < 0.75 ? (word + 1 + Math.floor(Math.random() * 3)) % 4 : word; t0 = performance.now(); };
    return {
      down(p) { if (p.y < env.H * 0.62) return; const i = Math.floor(p.x / (env.W / 4)); total++; if (i === ink) { ok++; rt = rt ? rt * 0.7 + (performance.now() - t0) * 0.3 : performance.now() - t0; env.audio.tick(); } else { flash = 0.3; env.audio.bad(); } next(); },
      frame(dt) { const W = env.W, H = env.H; flash = Math.max(0, flash - dt);
        if (flash > 0) { ctx.fillStyle = css("--accent-2"); ctx.globalAlpha = flash; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
        label(ctx, names[word], W / 2, H * 0.36, Math.min(W * 0.16, 64), INK[names[ink]], 800);
        names.forEach((n, i) => { ctx.fillStyle = INK[n]; roundRect(ctx, (i * W) / 4 + 8, H * 0.68, W / 4 - 16, H * 0.22, 10); ctx.fill(); }); },
      status: () => (total ? `${ok}/${total} · ${Math.round(rt)} ms` : "prêt"),
      result: () => ({ score: clamp100(Math.min(100, ok * 3) * (pct(ok, total) / 100)), metric: Math.round(rt), label: "ms par bonne réponse" }),
    };
  },
};
