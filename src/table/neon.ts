/** Monde 1 · NÉON : rampe en boucle au-dessus de trois bumpers, banc de cibles tombantes, spinner, trou bonus. */
import { seg, disc, poly, arc, type World } from "../physics/world";
import { v } from "../engine/vec";
import { buildShell, buildLanes, S, shellLamps, shellLabels } from "./shell";
import type { TableDef } from "./types";

export const neon: TableDef = {
  id: "neon", name: "NÉON", lanes: ["N", "O", "V", "A"],
  build(w: World) {
    buildShell(w); buildLanes(w, 4);
    const rail = { e: 0.55 };
    w.colliders.push(disc("bump1", 140, 240, 17, { e: 0.3, kick: 950, tag: "bumper" }), disc("bump2", 232, 240, 17, { e: 0.3, kick: 950, tag: "bumper" }), disc("bump3", 186, 310, 17, { e: 0.3, kick: 950, tag: "bumper" }));
    w.colliders.push(seg("dropBack", 50, 290, 50, 384, rail)); [300, 326, 352].forEach((y, i) => w.colliders.push(seg(`drop${i}`, 58, y, 58, y + 20, { e: 0.3, tag: "drop" })));
    w.colliders.push(seg("stdBack", 330, 290, 330, 376, rail)); [300, 324, 348].forEach((y, i) => w.colliders.push(seg(`std${i}`, 322, y, 322, y + 18, { e: 0.3, tag: "target" })));
    w.colliders.push(seg("spinL", 296, 180, 296, 266, rail), seg("spinR", 326, 180, 326, 266, rail), disc("spinPost1", 296, 266, 4, { e: 0.8 }), disc("spinPost2", 326, 266, 4, { e: 0.8 }));
    w.colliders.push(...poly("lockCup", arc(62, 236, 18, Math.PI * 0.75, Math.PI * 1.85, 10), { e: 0.2 }));
    const inner = 65, outer = 91, cx = 186, cy = 300;
    w.colliders.push(...poly("rampOuter", [[95, 500], [95, 300], ...arc(cx, cy, outer, Math.PI, Math.PI * 2, 30), [277, 300], [277, 470]], { layer: 1, e: 0.3 }));
    w.colliders.push(...poly("rampInner", [[121, 500], [121, 300], ...arc(cx, cy, inner, Math.PI, Math.PI * 2, 24), [251, 300], [251, 470]], { layer: 1, e: 0.3 }));
    w.colliders.push(disc("postA", 92, 440, 6, { e: 0.9 }), disc("postB", 280, 440, 6, { e: 0.9 }), disc("postC", 70, 400, 6, { e: 0.9 }), disc("postD", 300, 400, 6, { e: 0.9 }));
    w.sensors.push(S("spinner", 311, 224, 9, "spinner"), S("saucer", 186, 420, 9, "saucer"), S("lock", 62, 240, 9, "lock"),
      S("rampIn", 108, 476, 12, "rampIn", { dir: v(0, -1), layerTo: 1 }), S("rampBack", 108, 476, 12, "rampBack", { layer: 1, dir: v(0, 1), layerTo: 0 }),
      S("rampTop", 186, 222, 14, "rampTop", { layer: 1, dir: v(1, 0) }), S("rampOut", 264, 452, 12, "rampOut", { layer: 1, dir: v(0, 1), layerTo: 0 }));
  },
  lamps: [...shellLamps,
    { id: "drop0", x: 74, y: 310, r: 5, shape: "round", color: "#ff5a3c" }, { id: "drop1", x: 74, y: 336, r: 5, shape: "round", color: "#ff5a3c" }, { id: "drop2", x: 74, y: 362, r: 5, shape: "round", color: "#ff5a3c" },
    { id: "std0", x: 306, y: 309, r: 5, shape: "round", color: "#4ad1ff" }, { id: "std1", x: 306, y: 333, r: 5, shape: "round", color: "#4ad1ff" }, { id: "std2", x: 306, y: 357, r: 5, shape: "round", color: "#4ad1ff" },
    { id: "ramp", x: 108, y: 520, r: 9, shape: "arrow", color: "#7dff8a", ang: -Math.PI / 2 }, { id: "ramp2", x: 108, y: 545, r: 7, shape: "arrow", color: "#7dff8a", ang: -Math.PI / 2 },
    { id: "saucer", x: 186, y: 450, r: 9, shape: "arrow", color: "#ff8cf0", ang: -Math.PI / 2 }, { id: "lock", x: 86, y: 262, r: 7, shape: "arrow", color: "#ffffff", ang: Math.PI * 0.85 }, { id: "spinner", x: 311, y: 290, r: 7, shape: "arrow", color: "#ffd24a", ang: -Math.PI / 2 }],
  plastics: [{ pts: [[118, 206], [162, 206], [186, 250], [160, 290], [118, 262]], color: "#101a3a", label: "100", lx: 146, ly: 266 }, { pts: [[254, 206], [210, 206], [186, 250], [212, 290], [254, 262]], color: "#101a3a", label: "100", lx: 226, ly: 266 },
    { pts: [[42, 288], [50, 288], [50, 386], [42, 386]], color: "#ff5a3c", label: "1000", lx: 46, ly: 400 }, { pts: [[330, 288], [340, 288], [340, 378], [330, 378]], color: "#4ad1ff", label: "500", lx: 335, ly: 392 }],
  labels: [...shellLabels, { text: "VERROU", x: 62, y: 268 }, { text: "SPINNER 200", x: 311, y: 302 }, { text: "ROUE NOVA", x: 186, y: 470 }, { text: "RAMPE 2500", x: 108, y: 560 }],
  ramps: [{ outer: "rampOuter", inner: "rampInner", labels: [{ text: "RAMPE", x: 108, y: 492 }, { text: "JACKPOT", x: 264, y: 462 }] }],
  eject: { x: 186, y: 440, vx: 0, vy: 520 },
  art(ctx, t, accent) {
    ctx.save(); ctx.translate(186, 300); ctx.globalAlpha = 0.35; ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + t * 0.05; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 24, Math.sin(a) * 24); ctx.lineTo(Math.cos(a) * (i % 2 ? 150 : 110), Math.sin(a) * (i % 2 ? 150 : 110)); ctx.stroke(); }
    for (const r of [120, 160]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.setLineDash([4, 10]); ctx.stroke(); ctx.setLineDash([]); } ctx.restore();
  },
};
