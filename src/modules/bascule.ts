import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100, pct } from "./types";
import { INK, label, roundRect, circle } from "../engine/draw";

export const bascule: ModuleDef = {
  id: "bascule", name: "Bascule", regions: ["prefrontal"], duration: 60, scored: true,
  tagline: "Flexibilité : la règle change sans prévenir.",
  hint: "Glisse à gauche ou à droite selon la règle affichée. La règle change.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env; let rule = 0, shape = 0, color = 0, ok = 0, total = 0, since = 0, nextSwitch = 5, dragX = 0, switchCost = 0, afterSwitch = false, t0 = performance.now(), rtNormal: number[] = [], rtSwitch: number[] = [];
    const gen = () => { shape = Math.random() < 0.5 ? 0 : 1; color = Math.random() < 0.5 ? 0 : 1; afterSwitch = false; if (++since >= nextSwitch) { rule ^= 1; since = 0; nextSwitch = 4 + Math.floor(Math.random() * 4); afterSwitch = true; } t0 = performance.now(); };
    gen();
    return {
      drag(p) { dragX = p.x - p.sx; },
      up(p) { const dx = p.x - p.sx; dragX = 0; if (Math.abs(dx) < 24) return; const want = rule === 0 ? color : shape, got = dx < 0 ? 0 : 1; total++; const rt = performance.now() - t0; if (got === want) { ok++; (afterSwitch ? rtSwitch : rtNormal).push(rt); env.audio.tick(); } else env.audio.bad(); gen();
        const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y) / a.length : 0); switchCost = rtSwitch.length && rtNormal.length ? Math.round(avg(rtSwitch) - avg(rtNormal)) : 0; },
      frame() { const W = env.W, H = env.H; label(ctx, rule === 0 ? "RÈGLE : COULEUR" : "RÈGLE : FORME", W / 2, H * 0.12, Math.min(W * 0.055, 22), css("--accent"));
        label(ctx, rule === 0 ? "◀ rouge      bleu ▶" : "◀ rond      carré ▶", W / 2, H * 0.22, Math.min(W * 0.045, 18), css("--muted"), 600);
        const col = color === 0 ? INK.rouge : INK.bleu, cx = W / 2 + dragX * 0.6, cy = H * 0.58, r = Math.min(W, H) * 0.13; ctx.fillStyle = col; if (shape === 0) { circle(ctx, cx, cy, r); ctx.fill(); } else { roundRect(ctx, cx - r, cy - r, 2 * r, 2 * r, 8); ctx.fill(); } },
      status: () => (total ? `${ok}/${total} · coût du changement ${switchCost} ms` : "prêt"),
      result: () => ({ score: clamp100(Math.min(100, ok * 4) * (pct(ok, total) / 100)), metric: switchCost, label: "ms de coût au changement" }),
    };
  },
};
