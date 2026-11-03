import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { Rng } from "../engine/rng";
import { roundRect, circle } from "../engine/draw";

/** Labyrinthe parfait par parcours en profondeur. walls[i] = [haut, droite, bas, gauche]. */
export function makeMaze(n: number, rng: Rng): boolean[][] {
  const walls = Array.from({ length: n * n }, () => [true, true, true, true]);
  const seen = new Set([0]), st = [0];
  while (st.length) {
    const c = st[st.length - 1], x = c % n, y = Math.floor(c / n);
    const nb = [[0, x, y - 1], [1, x + 1, y], [2, x, y + 1], [3, x - 1, y]].filter(([, a, b]) => a >= 0 && b >= 0 && a < n && b < n && !seen.has(b * n + a));
    if (!nb.length) { st.pop(); continue; }
    const [d, a, b] = nb[rng.int(nb.length)]; walls[c][d] = false; walls[b * n + a][(d + 2) % 4] = false; seen.add(b * n + a); st.push(b * n + a);
  }
  return walls;
}

export const chemin: ModuleDef = {
  id: "chemin", name: "Chemin", regions: ["hippocampe"], duration: 90, scored: true,
  tagline: "Labyrinthe de mémoire : avance dans le noir.",
  hint: "Mémorise le labyrinthe, puis glisse pour avancer dans le noir.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env; const rng = new Rng(); let n = 4, walls = makeMaze(n, rng), px = 0, py = 0, show = 3, reveal = 0, done = 0, hits = 0;
    const gen = () => { walls = makeMaze(n, rng); px = 0; py = 0; show = 2 + n * 0.4; };
    return {
      up(p) { if (show > 0) return; const dx = p.x - p.sx, dy = p.y - p.sy; if (Math.hypot(dx, dy) < 18) return; const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
        if (walls[py * n + px][d]) { hits++; reveal = 0.8; env.audio.bad(); return; } px += [0, 1, 0, -1][d]; py += [-1, 0, 1, 0][d]; env.audio.tick(); if (px === n - 1 && py === n - 1) { done++; env.audio.good(); if (done % 2 === 0 && n < 9) n++; gen(); } },
      frame(dt) { const W = env.W, H = env.H; show -= dt; reveal = Math.max(0, reveal - dt); const S = Math.min(W, H) * 0.84, cs = S / n, ox = (W - S) / 2, oy = (H - S) / 2;
        const vis = show > 0 ? 1 : reveal; ctx.strokeStyle = css("--fg"); ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.globalAlpha = Math.max(0.06, vis);
        for (let i = 0; i < n * n; i++) { const x = ox + (i % n) * cs, y = oy + Math.floor(i / n) * cs, w = walls[i]; ctx.beginPath(); if (w[0]) { ctx.moveTo(x, y); ctx.lineTo(x + cs, y); } if (w[1]) { ctx.moveTo(x + cs, y); ctx.lineTo(x + cs, y + cs); } if (w[2]) { ctx.moveTo(x, y + cs); ctx.lineTo(x + cs, y + cs); } if (w[3]) { ctx.moveTo(x, y); ctx.lineTo(x, y + cs); } ctx.stroke(); }
        ctx.globalAlpha = 1; ctx.fillStyle = css("--accent-2"); roundRect(ctx, ox + (n - 1) * cs + cs * 0.3, oy + (n - 1) * cs + cs * 0.3, cs * 0.4, cs * 0.4, 4); ctx.fill();
        ctx.fillStyle = css("--accent"); circle(ctx, ox + px * cs + cs / 2, oy + py * cs + cs / 2, cs * 0.22); ctx.fill(); },
      status: () => (show > 0 ? `mémorise… ${Math.ceil(show)}` : `${n}×${n} · ${done} réussis · ${hits} murs`),
      result: () => ({ score: clamp100(done * 25 - hits * 3), metric: done, label: "labyrinthes réussis" }),
    };
  },
};
