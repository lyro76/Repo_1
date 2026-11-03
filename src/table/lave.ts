/** Monde 2 · LAVE : volcan central avec cratère, orbite droite qui passe derrière les couloirs, quatre bumpers en V, cibles en haut. */
import { seg, disc, poly, arc, type World } from "../physics/world";
import { v } from "../engine/vec";
import { buildShell, buildLanes, S, shellLamps, shellLabels } from "./shell";
import type { TableDef } from "./types";

export const lave: TableDef = {
  id: "lave", name: "LAVE", lanes: ["L", "A", "V", "E"],
  build(w: World) {
    buildShell(w); buildLanes(w, 4, 100, 150);
    const rail = { e: 0.55 };
    // orbite : arc intérieur en deux parties, ouvert au sommet (chute dans les couloirs) et aux deux extrémités
    w.colliders.push(...poly("orbitR", arc(200, 200, 150, Math.PI * 1.56, Math.PI * 1.92, 14), rail));
    w.colliders.push(disc("orbitPostR", 200 + Math.cos(Math.PI * 1.92) * 150, 200 + Math.sin(Math.PI * 1.92) * 150, 5, { e: 0.8 }), disc("orbitPostT", 200 + Math.cos(Math.PI * 1.56) * 150, 200 + Math.sin(Math.PI * 1.56) * 150, 5, { e: 0.8 }));
    // volcan : montagne solide, cratère au sommet
    w.colliders.push(disc("volcano", 186, 330, 46, { e: 0.45, tag: "volcano" }));
    w.colliders.push(disc("bump1", 104, 390, 16, { e: 0.3, kick: 950, tag: "bumper" }), disc("bump2", 268, 390, 16, { e: 0.3, kick: 950, tag: "bumper" }), disc("bump3", 134, 450, 16, { e: 0.3, kick: 950, tag: "bumper" }), disc("bump4", 238, 450, 16, { e: 0.3, kick: 950, tag: "bumper" }));
    w.colliders.push(seg("dropBack", 50, 250, 50, 346, rail)); [258, 282, 306, 330].forEach((y, i) => w.colliders.push(seg(`drop${i}`, 58, y, 58, y + 16, { e: 0.3, tag: "drop" })));
    w.colliders.push(seg("stdBack", 276, 248, 344, 230, rail), disc("stdBackPost", 276, 248, 4, { e: 0.8 })); [282, 306, 330].forEach((x, i) => w.colliders.push(seg(`std${i}`, x, 256 - (x - 276) * 0.26, x + 18, 256 - (x + 18 - 276) * 0.26, { e: 0.3, tag: "target" })));
    w.colliders.push(...poly("lockCup", arc(72, 440, 18, Math.PI * 0.9, Math.PI * 2.0, 10), { e: 0.2 }));
    w.colliders.push(disc("postA", 100, 300, 6, { e: 0.9 }), disc("postB", 272, 300, 6, { e: 0.9 }), disc("postC", 300, 470, 6, { e: 0.9 }));
    w.sensors.push(S("saucer", 186, 276, 9, "saucer"), S("lock", 72, 444, 9, "lock"), S("orbitR", 352, 300, 11, "orbit", { dir: v(0, -1) }));
  },
  lamps: [...shellLamps,
    ...[258, 282, 306, 330].map((y, i) => ({ id: `drop${i}`, x: 74, y: y + 8, r: 5, shape: "round" as const, color: "#ff5a3c" })),
    ...[282, 306, 330].map((x, i) => ({ id: `std${i}`, x: x + 9, y: 274 - (x - 276) * 0.26, r: 5, shape: "round" as const, color: "#ffb347" })),
    { id: "saucer", x: 186, y: 400, r: 9, shape: "arrow", color: "#ff8cf0", ang: -Math.PI / 2 }, { id: "lock", x: 96, y: 470, r: 7, shape: "arrow", color: "#ffffff", ang: Math.PI * 0.8 },
    { id: "orbitR", x: 326, y: 300, r: 7, shape: "arrow", color: "#ffb347", ang: -Math.PI / 2 }],
  plastics: [{ pts: [[42, 246], [50, 246], [50, 350], [42, 350]], color: "#ff5a3c", label: "1000", lx: 46, ly: 364 }, { pts: [[276, 240], [344, 222], [344, 230], [276, 248]], color: "#ffb347", label: "500", lx: 314, ly: 214 }],
  labels: [...shellLabels, { text: "CRATÈRE = ROUE", x: 186, y: 412 }, { text: "VERROU", x: 72, y: 482 }, { text: "ORBITE 3000", x: 326, y: 314 }],
  ramps: [],
  eject: { x: 186, y: 400, vx: 0, vy: 500 },
  art(ctx, t) {
    // volcan peint : cône, coulées, lueur du cratère
    ctx.save(); const g = ctx.createRadialGradient(186, 290, 4, 186, 330, 70); g.addColorStop(0, "#ffd080"); g.addColorStop(0.3, "#ff6a2c"); g.addColorStop(1, "#3a1008"); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(100, 380); ctx.lineTo(176, 268); ctx.lineTo(196, 268); ctx.lineTo(272, 380); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#ff8a3c"; ctx.lineWidth = 3; ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 3); for (const [dx, k] of [[-20, 1], [14, 1.3], [30, 0.8]] as const) { ctx.beginPath(); ctx.moveTo(186 + dx * 0.3, 280); ctx.quadraticCurveTo(186 + dx * k, 330, 186 + dx * k * 2.2, 390); ctx.stroke(); }
    ctx.restore();
  },
};
