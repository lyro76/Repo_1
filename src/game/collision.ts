import type { Creature } from "../char/creatures";
import type { Player } from "./player";
import { LANE_X, type Coin, type Obstacle } from "./world";

/** Hauteur de l'obstacle par type : bas = on saute, haut = on glisse, bloc = on évite. */
export function obstacleBox(o: Obstacle) {
  const x = LANE_X[o.lane];
  if (o.kind === "low") return { x, zMin: o.z, zMax: o.z + o.length, yMin: 0, yMax: 0.7 };
  if (o.kind === "high") return { x, zMin: o.z, zMax: o.z + o.length, yMin: 0.9, yMax: 2.4 };
  return { x, zMin: o.z, zMax: o.z + o.length, yMin: 0, yMax: 1.5 };
}

export function creatureBox(c: Creature) {
  const h = c.hitHeight;
  return { x: c.pos.x, zMin: c.pos.z - 0.35, zMax: c.pos.z + 0.35, yMin: c.pos.y, yMax: c.pos.y + h };
}

type Box = { x: number; zMin: number; zMax: number; yMin: number; yMax: number };

export function overlaps(a: Box, b: Box, laneTolerance = 0.9) {
  return Math.abs(a.x - b.x) < laneTolerance && a.zMin < b.zMax && a.zMax > b.zMin && a.yMin < b.yMax && a.yMax > b.yMin;
}

export function coinHit(p: Player, c: Coin) {
  return Math.abs(p.x - LANE_X[c.lane]) < 0.8 && Math.abs(c.z - p.z) < 0.5 && c.y < p.y + 1.6 && c.y + 0.4 > p.y;
}
