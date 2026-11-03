import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100, pct } from "./types";
import { roundRect } from "../engine/draw";

type C = [number, number][];
const norm = (c: C): C => { const mx = Math.min(...c.map((p) => p[0])), my = Math.min(...c.map((p) => p[1])); return c.map((p) => [p[0] - mx, p[1] - my]); };
export const rot = (c: C): C => norm(c.map(([x, y]) => [-y, x]));
export const mir = (c: C): C => norm(c.map(([x, y]) => [-x, y]));
export const same = (a: C, b: C) => a.length === b.length && norm(a).every((p) => b.some((q) => q[0] === p[0] && q[1] === p[1]));
/** polyomino aléatoire de n cases, rejeté s'il est symétrique (sinon miroir = rotation). */
export function polyomino(n: number, rnd = Math.random): C {
  for (;;) {
    let cells: C = [[0, 0]];
    while (cells.length < n) { const [x, y] = cells[Math.floor(rnd() * cells.length)]; const d = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rnd() * 4)]; const q: [number, number] = [x + d[0], y + d[1]]; if (!cells.some((p) => p[0] === q[0] && p[1] === q[1])) cells.push(q); }
    cells = norm(cells);
    let m = mir(cells), sym = false; for (let i = 0; i < 4; i++) { if (same(m, cells)) sym = true; m = rot(m); }
    if (!sym) return cells;
  }
}

export const miroir: ModuleDef = {
  id: "miroir", name: "Miroir", regions: ["parietal"], duration: 60, scored: true,
  tagline: "Rotation mentale : la pièce tournée, pas retournée.",
  hint: "Laquelle des deux formes du bas est la forme du haut, tournée (pas retournée) ?",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env; let cells: C = [], a: C = [], b: C = [], answer = 0, ok = 0, total = 0, t0 = performance.now(), rt = 0, n = 4;
    const gen = () => { cells = polyomino(n); let r = cells, m = mir(cells); const k = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < k; i++) r = rot(r); for (let i = 0; i < Math.floor(Math.random() * 4); i++) m = rot(m);
      answer = Math.random() < 0.5 ? 0 : 1; a = answer === 0 ? r : m; b = answer === 0 ? m : r; t0 = performance.now(); };
    gen();
    const draw = (c: C, cx: number, cy: number, s: number, col: string) => { const w = Math.max(...c.map((p) => p[0])) + 1, h = Math.max(...c.map((p) => p[1])) + 1; ctx.fillStyle = col; for (const [x, y] of c) { roundRect(ctx, cx + (x - w / 2) * s + 1, cy + (y - h / 2) * s + 1, s - 2, s - 2, 3); ctx.fill(); } };
    return {
      down(p) { if (p.y < env.H * 0.5) return; const pick = p.x < env.W / 2 ? 0 : 1; total++; if (pick === answer) { ok++; rt = rt ? rt * 0.7 + (performance.now() - t0) * 0.3 : performance.now() - t0; env.audio.tick(); if (ok % 5 === 0 && n < 7) n++; } else env.audio.bad(); gen(); },
      frame() { const W = env.W, H = env.H, s = Math.min(W, H) * 0.06; draw(cells, W / 2, H * 0.25, s, css("--fg")); ctx.strokeStyle = css("--line"); ctx.beginPath(); ctx.moveTo(W * 0.1, H * 0.5); ctx.lineTo(W * 0.9, H * 0.5); ctx.moveTo(W / 2, H * 0.55); ctx.lineTo(W / 2, H * 0.95); ctx.stroke();
        draw(a, W * 0.27, H * 0.74, s, css("--accent")); draw(b, W * 0.73, H * 0.74, s, css("--accent")); },
      status: () => (total ? `${ok}/${total} · ${Math.round(rt)} ms` : "prêt"),
      result: () => ({ score: clamp100(Math.min(100, ok * 5) * (pct(ok, total) / 100)), metric: Math.round(rt), label: "ms par bonne réponse" }),
    };
  },
};
