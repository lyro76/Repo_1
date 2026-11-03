/** Monde 4 · JUNGLE : liane sinueuse (couloir serpentin), deux gros bumpers, palette supplémentaire à droite qui vise cinq cibles à gauche. */
import { seg, disc, flipper, poly, arc, type World } from "../physics/world";
import { v, sub, norm, perp, add, mul } from "../engine/vec";
import { buildShell, buildLanes, S, shellLamps, shellLabels } from "./shell";
import type { TableDef } from "./types";

/** décale une polyligne de d unités le long de ses normales (pour faire un couloir). */
function offset(pts: [number, number][], d: number): [number, number][] {
  return pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const n = perp(norm(sub(v(b[0], b[1]), v(a[0], a[1])))); const q = add(v(p[0], p[1]), mul(n, d)); return [q.x, q.y]; });
}
const LIANE: [number, number][] = [[40, 230], [96, 262], [60, 310], [112, 356], [70, 404], [130, 440], [186, 466]];

export const jungle: TableDef = {
  id: "jungle", name: "JUNGLE", lanes: ["J", "U", "N", "G", "L", "E"],
  build(w: World) {
    buildShell(w); buildLanes(w, 6, 100, 150, 44);
    const rail = { e: 0.55 };
    w.colliders.push(...poly("lianeA", offset(LIANE, -13), { e: 0.35 }), ...poly("lianeB", offset(LIANE, 13), { e: 0.35 }));
    w.colliders.push(disc("bump1", 250, 300, 24, { e: 0.3, kick: 1000, tag: "bumper" }), disc("bump2", 310, 380, 22, { e: 0.3, kick: 1000, tag: "bumper" }));
    w.colliders.push(seg("stdBack", 44, 496, 44, 584, rail)); [500, 518, 536, 554, 572].forEach((y, i) => w.colliders.push(seg(`std${i}`, 52, y, 52, y + 14, { e: 0.3, tag: "target" })));
    // la palette supplémentaire remplace le couloir extérieur droit : on la pose sur un guide
    w.colliders.push(seg("upGuide", 362, 380, 362, 436, rail), seg("upGuideFoot", 362, 436, 348, 454, rail), flipper("flipR2", 340, 452, 46, 1));
    w.colliders.push(seg("dropBack", 236, 202, 316, 202, rail)); [244, 270, 296].forEach((x, i) => w.colliders.push(seg(`drop${i}`, x, 210, x + 18, 210, { e: 0.3, tag: "drop" })));
    w.colliders.push(...poly("lockCup", arc(300, 250, 18, Math.PI * 0.55, Math.PI * 1.7, 10), { e: 0.2 }));
    w.colliders.push(disc("postA", 200, 250, 6, { e: 0.9 }), disc("postB", 150, 220, 6, { e: 0.9 }), disc("postC", 226, 420, 6, { e: 0.9 }));
    w.sensors.push(S("lianeIn", 40, 212, 12, "liane", { dir: v(0.5, 1) }), S("lianeOut", 186, 470, 10, "lianeOut", { dir: v(0.5, 1) }), S("saucer", 236, 462, 9, "saucer"), S("lock", 300, 254, 9, "lock"));
  },
  lamps: [...shellLamps.filter((l) => l.id !== "outlaneR"),
    ...[500, 518, 536, 554, 572].map((y, i) => ({ id: `std${i}`, x: 66, y: y + 7, r: 4, shape: "round" as const, color: "#ffe27a" })),
    ...[244, 270, 296].map((x, i) => ({ id: `drop${i}`, x: x + 9, y: 228, r: 5, shape: "round" as const, color: "#ff5a3c" })),
    { id: "liane", x: 60, y: 200, r: 7, shape: "arrow", color: "#7dff8a", ang: Math.PI / 2 }, { id: "saucer", x: 236, y: 492, r: 9, shape: "arrow", color: "#ff8cf0", ang: -Math.PI / 2 }, { id: "lock", x: 270, y: 240, r: 7, shape: "arrow", color: "#ffffff", ang: 0 }],
  plastics: [{ pts: [[36, 494], [44, 494], [44, 586], [36, 586]], color: "#ffe27a", label: "500", lx: 40, ly: 598 }, { pts: [[236, 194], [316, 194], [316, 202], [236, 202]], color: "#ff5a3c", label: "1000", lx: 276, ly: 186 }],
  labels: [...shellLabels.filter((l) => l.text !== "1000" || l.x < 100), { text: "LIANE 2000", x: 96, y: 212 }, { text: "ROUE", x: 236, y: 504 }, { text: "VERROU", x: 300, y: 282 }, { text: "PALETTE HAUTE", x: 330, y: 476, size: 7 }],
  ramps: [],
  eject: { x: 236, y: 480, vx: -120, vy: 480 },
  art(ctx, t) {
    ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = "#2f8a3e"; ctx.lineWidth = 2; ctx.fillStyle = "#1f6a2e";
    for (let i = 0; i < 14; i++) { const x = 80 + ((i * 97) % 240), y = 230 + ((i * 61) % 240), a = i + Math.sin(t + i) * 0.1; ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, 0, 18, 7, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(18, 0); ctx.stroke(); ctx.restore(); }
    ctx.restore();
  },
};
