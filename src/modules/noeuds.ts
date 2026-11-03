import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { Rng } from "../engine/rng";
import { circle } from "../engine/draw";

type P = { x: number; y: number };
const orient = (p: P, q: P, r: P) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
export const segmentsCross = (a: P, b: P, c: P, d: P) => { const s1 = orient(a, b, c), s2 = orient(a, b, d), s3 = orient(c, d, a), s4 = orient(c, d, b); return s1 * s2 < 0 && s3 * s4 < 0; };

/** Graphe planaire par construction (polygone + cordes sans croisement), positions mélangées. */
export function makeGraph(n: number, rng: Rng) {
  const edges: [number, number][] = [];
  for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
  // triangulation en éventail depuis un sommet aléatoire, perturbée par des "flips" valides
  const apex = rng.int(n);
  for (let k = 2; k < n - 1; k++) edges.push([apex, (apex + k) % n]);
  const pts: P[] = Array.from({ length: n }, () => ({ x: 0.12 + rng.next() * 0.76, y: 0.12 + rng.next() * 0.76 }));
  return { pts, edges };
}

export const countCrossings = (pts: P[], edges: [number, number][]) => {
  let c = 0;
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const [a, b] = edges[i], [cc, d] = edges[j]; if (a === cc || a === d || b === cc || b === d) continue;
    if (segmentsCross(pts[a], pts[b], pts[cc], pts[d])) c++;
  }
  return c;
};

export const noeuds: ModuleDef = {
  id: "noeuds", name: "Nœuds", regions: ["parietal"], duration: 90, scored: true,
  tagline: "Démêle le réseau : aucune ligne ne doit se croiser.",
  hint: "Déplace les points jusqu'à ce qu'aucune ligne ne se croise.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env; const rng = new Rng();
    let n = 6, g = makeGraph(n, rng), drag = -1, moves = 0, solved = 0, flashT = 0;
    const fresh = () => { while (countCrossings(g.pts, g.edges) === 0) g = makeGraph(n, rng); };
    fresh();
    return {
      down(p) { let bi = -1, bd = 36; g.pts.forEach((q, i) => { const d = Math.hypot(q.x * env.W - p.x, q.y * env.H - p.y); if (d < bd) { bd = d; bi = i; } }); drag = bi; if (bi >= 0) moves++; },
      drag(p) { if (drag < 0) return; g.pts[drag].x = Math.min(0.95, Math.max(0.05, p.x / env.W)); g.pts[drag].y = Math.min(0.95, Math.max(0.05, p.y / env.H)); },
      up() { drag = -1; if (countCrossings(g.pts, g.edges) === 0) { solved++; env.audio.good(); flashT = 0.6; n = Math.min(14, n + 1); g = makeGraph(n, rng); fresh(); } },
      frame(dt) {
        const W = env.W, H = env.H; flashT = Math.max(0, flashT - dt);
        for (const [a, b] of g.edges) {
          let bad = false; for (const [c, d] of g.edges) { if (a === c || a === d || b === c || b === d) continue; if (segmentsCross(g.pts[a], g.pts[b], g.pts[c], g.pts[d])) { bad = true; break; } }
          ctx.strokeStyle = bad ? css("--accent-2") : css("--accent"); ctx.lineWidth = bad ? 2 : 2.5; ctx.beginPath(); ctx.moveTo(g.pts[a].x * W, g.pts[a].y * H); ctx.lineTo(g.pts[b].x * W, g.pts[b].y * H); ctx.stroke();
        }
        g.pts.forEach((p, i) => { ctx.fillStyle = css("--surface"); ctx.strokeStyle = css("--fg"); ctx.lineWidth = 2.5; circle(ctx, p.x * W, p.y * H, i === drag ? 14 : 10); ctx.fill(); ctx.stroke(); });
        if (flashT > 0) { ctx.fillStyle = css("--accent"); ctx.globalAlpha = flashT * 0.4; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
      },
      status: () => `${countCrossings(g.pts, g.edges)} croisements · ${solved} résolus`,
      result: () => ({ score: clamp100(solved * 20), metric: solved, label: "réseaux démêlés" }),
    };
  },
};
