import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { circle } from "../engine/draw";

export const intrus: ModuleDef = {
  id: "intrus", name: "Intrus", regions: ["occipital"], duration: 60, scored: true,
  tagline: "Trouve le disque de teinte différente.",
  hint: "Touche le disque qui n'a pas exactement la même couleur.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env; let odd = 0, hue = 0, delta = 18, level = 1, flash = 0, minDelta = 18;
    const gen = () => { odd = Math.floor(Math.random() * 16); hue = Math.random() * 360; };
    gen();
    const geom = () => { const S = Math.min(env.W, env.H) * 0.84; return { S, cs: S / 4, ox: (env.W - S) / 2, oy: (env.H - S) / 2 }; };
    return {
      down(p) { const { cs, ox, oy } = geom(); const c = Math.floor((p.x - ox) / cs), r = Math.floor((p.y - oy) / cs); if (c < 0 || r < 0 || c > 3 || r > 3) return;
        if (r * 4 + c === odd) { level++; delta = Math.max(2, delta * 0.85); minDelta = Math.min(minDelta, delta); env.audio.tick(); } else { flash = 0.3; delta = Math.min(30, delta * 1.2); env.audio.bad(); } gen(); },
      frame(dt) { const { cs, ox, oy } = geom(); flash = Math.max(0, flash - dt);
        for (let i = 0; i < 16; i++) { ctx.fillStyle = `hsl(${hue + (i === odd ? delta : 0)} 55% 55%)`; circle(ctx, ox + (i % 4) * cs + cs / 2, oy + Math.floor(i / 4) * cs + cs / 2, cs * 0.38); ctx.fill(); }
        if (flash) { ctx.fillStyle = css("--accent-2"); ctx.globalAlpha = flash; ctx.fillRect(0, 0, env.W, env.H); ctx.globalAlpha = 1; } },
      status: () => `niveau ${level} · écart ${delta.toFixed(1)}°`,
      result: () => ({ score: clamp100(((18 - minDelta) / 16) * 100), metric: Math.round(minDelta * 10) / 10, label: "° de teinte perçus" }),
    };
  },
};
