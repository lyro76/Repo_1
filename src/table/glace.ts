/** Monde 3 · GLACE : champ de plots façon pachinko, banc de quatre cibles tombantes sous les couloirs, deux spinners latéraux. */
import { seg, disc, poly, arc, type World } from "../physics/world";
import { buildShell, buildLanes, S, shellLamps, shellLabels } from "./shell";
import type { TableDef } from "./types";

export const glace: TableDef = {
  id: "glace", name: "GLACE", lanes: ["G", "L", "A", "C", "E"],
  build(w: World) {
    buildShell(w); buildLanes(w, 5, 100, 150, 36);
    const rail = { e: 0.55 };
    w.colliders.push(seg("dropBackL", 126, 204, 186, 186, rail), seg("dropBackR", 186, 186, 246, 204, rail), seg("dropSideL", 126, 204, 126, 212, rail), seg("dropSideR", 246, 204, 246, 212, rail)); [136, 162, 188, 214].forEach((x, i) => w.colliders.push(seg(`drop${i}`, x, 212, x + 20, 212, { e: 0.3, tag: "drop" })));
    // champ de plots : 4 rangées en quinconce
    for (let r = 0; r < 4; r++) for (let c = 0; c < (r % 2 ? 4 : 5); c++) { const x = (r % 2 ? 126 : 106) + c * 40, y = 250 + r * 42; w.colliders.push(disc(`peg${r}${c}`, x, y, 5, { e: 0.85, tag: "peg" })); }
    // couloirs des spinners
    for (const [id, x0, x1] of [["L", 48, 76], ["R", 296, 324]] as const) { w.colliders.push(seg(`spin${id}a`, x0, 236, x0, 334, rail), seg(`spin${id}b`, x1, 236, x1, 334, rail), disc(`spin${id}p1`, x0, 334, 4, { e: 0.8 }), disc(`spin${id}p2`, x1, 334, 4, { e: 0.8 })); }
    w.colliders.push(disc("bump1", 112, 450, 15, { e: 0.3, kick: 900, tag: "bumper" }), disc("bump2", 260, 450, 15, { e: 0.3, kick: 900, tag: "bumper" }));
    w.colliders.push(...poly("lockCup", arc(62, 470, 18, Math.PI * 0.85, Math.PI * 1.95, 10), { e: 0.2 }));
    w.colliders.push(seg("stdBack", 338, 390, 338, 470, rail)); [398, 424, 450].forEach((y, i) => w.colliders.push(seg(`std${i}`, 330, y, 330, y + 16, { e: 0.3, tag: "target" })));
    w.sensors.push(S("spinnerL", 62, 285, 9, "spinner"), S("spinnerR", 310, 285, 9, "spinner"), S("saucer", 186, 446, 9, "saucer"), S("lock", 62, 474, 9, "lock"));
  },
  lamps: [...shellLamps,
    ...[136, 162, 188, 214].map((x, i) => ({ id: `drop${i}`, x: x + 10, y: 230, r: 5, shape: "round" as const, color: "#9ae6ff" })),
    ...[398, 424, 450].map((y, i) => ({ id: `std${i}`, x: 316, y: y + 8, r: 5, shape: "round" as const, color: "#4ad1ff" })),
    { id: "spinnerL", x: 62, y: 350, r: 7, shape: "arrow", color: "#ffd24a", ang: -Math.PI / 2 }, { id: "spinnerR", x: 310, y: 350, r: 7, shape: "arrow", color: "#ffd24a", ang: -Math.PI / 2 },
    { id: "saucer", x: 186, y: 476, r: 9, shape: "arrow", color: "#ff8cf0", ang: -Math.PI / 2 }, { id: "lock", x: 86, y: 496, r: 7, shape: "arrow", color: "#ffffff", ang: Math.PI * 0.85 }],
  plastics: [{ pts: [[126, 204], [186, 186], [246, 204], [246, 212], [126, 212]], color: "#9ae6ff", label: "1000", lx: 186, ly: 200 }, { pts: [[338, 388], [348, 388], [348, 472], [338, 472]], color: "#4ad1ff", label: "500", lx: 343, ly: 484 }],
  labels: [...shellLabels, { text: "SPINNER", x: 62, y: 362 }, { text: "SPINNER", x: 310, y: 362 }, { text: "ROUE", x: 186, y: 488 }, { text: "VERROU", x: 62, y: 506 }, { text: "PLOTS 25", x: 186, y: 420 }],
  ramps: [],
  eject: { x: 186, y: 470, vx: 0, vy: 480 },
  art(ctx, t, accent) {
    ctx.save(); ctx.strokeStyle = accent; ctx.globalAlpha = 0.3; ctx.lineWidth = 1.2;
    for (const [x, y, r] of [[186, 330, 60], [90, 500, 22], [290, 500, 22], [186, 560, 18]] as const) for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3 + t * 0.1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6); ctx.lineTo(x + Math.cos(a + 0.5) * r * 0.75, y + Math.sin(a + 0.5) * r * 0.75); ctx.stroke(); }
    ctx.restore();
  },
};
