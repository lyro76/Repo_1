/**
 * Coque commune à tous les plateaux : contour, couloir du lanceur, palettes, couloirs du bas, slingshots.
 * 400 × 760 unités, y vers le bas. Zone de jeu x ∈ [10, 362], centre x = 186.
 */
import { World, seg, disc, flipper, poly, arc, type Sensor } from "../physics/world";
import { v } from "../engine/vec";
import type { Lamp } from "./types";

export const TW = 400, TH = 760, CX = 186;
export const PLUNGER = { x: 376, y: 712 };
export const M = (x: number) => 372 - x;
export const S = (id: string, x: number, y: number, r: number, tag: string, o: Partial<Sensor> = {}): Sensor => ({ id, c: v(x, y), r, layer: 0, tag, ...o });

export function buildShell(w: World) {
  const rail = { e: 0.55 };
  w.colliders.push(...poly("top", arc(200, 200, 190, Math.PI, Math.PI * 2, 48), rail));
  w.colliders.push(seg("wallL", 10, 200, 10, 775, rail), seg("wallR", 390, 200, 390, 775, rail));
  w.colliders.push(seg("plungerWall", 362, 775, 362, 240, rail), seg("plungerCap", 362, 240, 350, 252, rail), disc("plungerCapPost", 350, 252, 4, { e: 0.8 }));
  w.colliders.push(seg("gate", 362, 236, 390, 222, { ...rail, gate: true }));
  w.colliders.push(seg("plungerStop", 362, 740, 390, 740, { e: 0.2, tag: "plungerStop" }));
  for (const side of [-1, 1] as const) {
    const X = (x: number) => (side === -1 ? x : M(x)), id = side === -1 ? "L" : "R";
    w.colliders.push(seg(`div${id}`, X(36), 500, X(36), 600, rail), disc(`post${id}1`, X(36), 500, 5, { e: 0.85 }));
    w.colliders.push(seg(`guide${id}`, X(36), 600, X(120), 700, { e: 0.4 }));
    const A = v(X(66), 520), B = v(X(66), 600), C = v(X(110), 650);
    w.colliders.push(seg(`sling${id}`, A.x, A.y, C.x, C.y, { e: 0.6, kick: 520, tag: "sling" }), seg(`sling${id}b`, B.x, B.y, C.x, C.y, { e: 0.5 }), seg(`sling${id}c`, A.x, A.y, B.x, B.y, { e: 0.5 }));
    w.colliders.push(disc(`post${id}2`, A.x, A.y, 5, { e: 0.9 }), disc(`post${id}3`, C.x, C.y, 5, { e: 0.9 }), disc(`post${id}4`, B.x, B.y, 5, { e: 0.9 }));
  }
  w.colliders.push(flipper("flipL", 120, 700, 56, -1), flipper("flipR", 252, 700, 56, 1));
  w.sensors.push(S("inlaneL", 50, 580, 10, "inlane"), S("inlaneR", M(50), 580, 10, "inlane"), S("outlaneL", 22, 560, 9, "outlane"), S("outlaneR", M(22), 560, 9, "outlane"));
}

/** Couloirs du haut : n couloirs centrés, capteurs lane0..lane(n-1). */
export function buildLanes(w: World, n: number, y0 = 112, y1 = 160, spacing = 40) {
  const x0 = CX - ((n - 1) * spacing) / 2;
  for (let i = 1; i < n; i++) { const x = x0 + (i - 0.5) * spacing; w.colliders.push(seg(`laneDiv${i}`, x, y0, x, y1, { e: 0.55 }), disc(`lanePost${i}`, x, y1, 4, { e: 0.8 })); }
  for (let i = 0; i < n; i++) w.sensors.push(S(`lane${i}`, x0 + i * spacing, y1 - 10, 11, "lane"));
  // rail d'amenée : la bille qui redescend l'arc à gauche est renvoyée vers les couloirs au lieu de filer le long du mur
  const ex = x0 - spacing / 2 + 8, ey = y0 - 8; w.colliders.push(seg("laneFeed", 44, 70, ex, ey, { e: 0.4 }));
  return { x0, spacing, y: y1 - 10 };
}

export const shellLamps: Lamp[] = [
  { id: "inlaneL", x: 50, y: 610, r: 6, shape: "round", color: "#7dff8a" }, { id: "inlaneR", x: 322, y: 610, r: 6, shape: "round", color: "#7dff8a" },
  { id: "outlaneL", x: 22, y: 590, r: 6, shape: "round", color: "#ff5a3c" }, { id: "outlaneR", x: 350, y: 590, r: 6, shape: "round", color: "#ff5a3c" },
  { id: "extra", x: 186, y: 560, r: 8, shape: "round", color: "#ff8cf0" },
  { id: "x2", x: 150, y: 500, r: 6, shape: "tri", color: "#4ad1ff" }, { id: "x3", x: 186, y: 500, r: 6, shape: "tri", color: "#4ad1ff" }, { id: "x4", x: 222, y: 500, r: 6, shape: "tri", color: "#4ad1ff" },
  { id: "shoot", x: 186, y: 640, r: 9, shape: "arrow", color: "#ffd24a", ang: -Math.PI / 2 },
  { id: "portal", x: 186, y: 522, r: 7, shape: "round", color: "#ffffff" },
];
export const shellPlastics = (bg: string) => [
  { pts: [[62, 514], [62, 606], [116, 656], [122, 640], [74, 596], [74, 522]] as [number, number][], color: "#7a1f33", label: "50", lx: 70, ly: 560 },
  { pts: [[310, 514], [310, 606], [256, 656], [250, 640], [298, 596], [298, 522]] as [number, number][], color: "#7a1f33", label: "50", lx: 302, ly: 560 },
].map((p) => ({ ...p, bg }));
export const shellLabels = [
  { text: "BONUS", x: 186, y: 520 }, { text: "X2  X3  X4", x: 186, y: 486 }, { text: "BILLE +", x: 186, y: 578 }, { text: "PORTAIL", x: 186, y: 536 },
  { text: "1000", x: 22, y: 606 }, { text: "1000", x: 350, y: 606 }, { text: "500", x: 50, y: 626 }, { text: "500", x: 322, y: 626 },
];
