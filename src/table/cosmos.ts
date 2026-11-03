/** Monde 5 · COSMOS : anneaux concentriques à ouvertures, planètes à toucher, trou noir qui attire la bille (roue), spinner en haut à droite. */
import { seg, disc, poly, arc, type World } from "../physics/world";
import { buildShell, buildLanes, S, shellLamps, shellLabels } from "./shell";
import type { TableDef } from "./types";

export const cosmos: TableDef = {
  id: "cosmos", name: "COSMOS", lanes: ["C", "O", "S", "M", "O", "S"],
  build(w: World) {
    buildShell(w); buildLanes(w, 6, 100, 150, 40);
    const rail = { e: 0.6 };
    const cx = 186, cy = 340;
    w.colliders.push(...poly("ring1a", arc(cx, cy, 70, Math.PI * 0.15, Math.PI * 0.85, 14), rail), ...poly("ring1b", arc(cx, cy, 70, Math.PI * 1.15, Math.PI * 1.85, 14), rail));
    w.colliders.push(...poly("ring2a", arc(cx, cy, 112, Math.PI * 0.62, Math.PI * 1.38, 16), rail), ...poly("ring2b", arc(cx, cy, 112, Math.PI * 1.62, Math.PI * 2.38, 16), rail));
    for (const [id, x, y, r] of [["planet0", 120, 262, 10], ["planet1", 262, 420, 12], ["planet2", 106, 426, 9], ["planet3", 266, 256, 11]] as const) w.colliders.push(disc(id, x, y, r, { e: 0.4, kick: 420, tag: "planet" }));
    w.colliders.push(disc("bump1", 130, 196, 14, { e: 0.3, kick: 950, tag: "bumper" }), disc("bump2", 242, 196, 14, { e: 0.3, kick: 950, tag: "bumper" }));
    w.colliders.push(seg("dropBack", 40, 300, 40, 376, rail)); [306, 330, 354].forEach((y, i) => w.colliders.push(seg(`drop${i}`, 48, y, 48, y + 16, { e: 0.3, tag: "drop" })));
    w.colliders.push(seg("stdBack", 338, 320, 338, 400, rail)); [326, 350, 374].forEach((y, i) => w.colliders.push(seg(`std${i}`, 330, y, 330, y + 16, { e: 0.3, tag: "target" })));
    w.colliders.push(seg("spinL", 296, 196, 296, 276, rail), seg("spinR", 326, 196, 326, 276, rail), disc("spinP1", 296, 276, 4, { e: 0.8 }), disc("spinP2", 326, 276, 4, { e: 0.8 }));
    w.colliders.push(...poly("lockCup", arc(318, 470, 18, Math.PI * 0.6, Math.PI * 1.75, 10), { e: 0.2 }));
    w.sensors.push(S("saucer", cx, cy, 8, "saucer"), S("lock", 318, 474, 9, "lock"), S("spinner", 311, 236, 9, "spinner"));
  },
  lamps: [...shellLamps,
    ...[306, 330, 354].map((y, i) => ({ id: `drop${i}`, x: 64, y: y + 8, r: 5, shape: "round" as const, color: "#ff8cf0" })),
    ...[326, 350, 374].map((y, i) => ({ id: `std${i}`, x: 316, y: y + 8, r: 5, shape: "round" as const, color: "#4ad1ff" })),
    { id: "spinner", x: 311, y: 294, r: 7, shape: "arrow", color: "#ffd24a", ang: -Math.PI / 2 }, { id: "lock", x: 292, y: 490, r: 7, shape: "arrow", color: "#ffffff", ang: Math.PI * 0.2 }, { id: "saucer", x: 186, y: 470, r: 9, shape: "arrow", color: "#ff8cf0", ang: -Math.PI / 2 }],
  plastics: [{ pts: [[32, 298], [40, 298], [40, 378], [32, 378]], color: "#ff8cf0", label: "1000", lx: 36, ly: 392 }, { pts: [[338, 318], [348, 318], [348, 402], [338, 402]], color: "#4ad1ff", label: "500", lx: 343, ly: 414 }],
  labels: [...shellLabels, { text: "TROU NOIR = ROUE", x: 186, y: 482 }, { text: "PLANÈTE 750", x: 186, y: 232 }, { text: "SPINNER", x: 311, y: 306 }, { text: "VERROU", x: 318, y: 500 }],
  ramps: [],
  eject: { x: 186, y: 430, vx: 160, vy: 420 },
  attractor: { x: 186, y: 340, r: 62, force: 1100 },
  art(ctx, t, accent) {
    ctx.save(); const g = ctx.createRadialGradient(186, 340, 2, 186, 340, 64); g.addColorStop(0, "#000"); g.addColorStop(0.5, "#1c0a3a"); g.addColorStop(1, "rgba(28,10,58,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(186, 340, 64, 0, 7); ctx.fill();
    ctx.strokeStyle = accent; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5; for (let k = 0; k < 3; k++) { ctx.beginPath(); for (let a = 0; a < 6.3; a += 0.15) { const r = 8 + a * 8; ctx.lineTo(186 + Math.cos(a + t * 1.5 + k * 2.1) * r, 340 + Math.sin(a + t * 1.5 + k * 2.1) * r * 0.9); } ctx.stroke(); }
    ctx.restore();
  },
};
