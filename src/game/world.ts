/**
 * La piste : 3 voies, obstacles et pièces générés par motifs, vitesse qui monte.
 * Tout est déterministe à partir d'une graine, et chaque motif laisse toujours
 * au moins une issue : c'est vérifié par les tests.
 */

import { Rng } from "../engine/rng";
import { makeCreature, type Creature, type CreatureKind } from "../char/creatures";

export const LANE_X = [-1.6, 0, 1.6];
export type ObstacleKind = "low" | "high" | "block";

export interface Obstacle {
  kind: ObstacleKind;
  lane: number;
  z: number;
  /** longueur en z */
  length: number;
  passed: boolean;
}

export interface Coin {
  lane: number;
  z: number;
  y: number;
  taken: boolean;
}

/** Comment éviter un obstacle : par la voie, en sautant, en glissant. */
export function avoidable(kind: ObstacleKind | CreatureKind, creatureAirborne = false): { jump: boolean; slide: boolean } {
  switch (kind) {
    case "low": return { jump: true, slide: false };
    case "high": return { jump: false, slide: true };
    case "block": return { jump: false, slide: false };
    case "blob": return { jump: true, slide: false };
    case "spider": return { jump: true, slide: false };
    case "hopper": return { jump: false, slide: creatureAirborne };
  }
}

export interface Pattern {
  name: string;
  /** lignes de 3 caractères, une par rangée (espacées de `gap`) : . vide, l bas, h haut, b bloc, c pièce, B blob, S araignée, H sauteur */
  rows: string[];
  minSpeed: number;
}

export const PATTERNS: Pattern[] = [
  { name: "coins-line", rows: ["c..", "c..", "c..", "c.."], minSpeed: 0 },
  { name: "coins-arc", rows: [".c.", "c.c", ".c."], minSpeed: 0 },
  { name: "single-low", rows: ["l.."], minSpeed: 0 },
  { name: "single-high", rows: [".h."], minSpeed: 0 },
  { name: "block-left", rows: ["b..", "b.."], minSpeed: 0 },
  { name: "two-blocks", rows: ["b.b", "b.b", ".c."], minSpeed: 1 },
  { name: "low-wall", rows: ["lll"], minSpeed: 1 },
  { name: "high-wall", rows: ["hhh", "..."], minSpeed: 1.2 },
  { name: "zigzag", rows: ["b..", "...", "..b", "...", "b.."], minSpeed: 1.2 },
  { name: "blob", rows: [".B.", "c.c"], minSpeed: 1 },
  { name: "spiders", rows: ["S.S", "...", ".S."], minSpeed: 1.4 },
  { name: "hopper", rows: ["..H", "...", "H.."], minSpeed: 1.5 },
  { name: "gauntlet", rows: ["bl.", "...", ".hb", "...", "l.l"], minSpeed: 1.8 },
  { name: "mixed", rows: ["Bb.", "...", ".cB", "b.."], minSpeed: 2 },
  { name: "coins-wave", rows: ["c..", ".c.", "..c", ".c.", "c.."], minSpeed: 0 },
];

export class World {
  obstacles: Obstacle[] = [];
  creatures: Creature[] = [];
  coins: Coin[] = [];
  /** distance parcourue (unités monde) */
  distance = 0;
  speed = 6;
  nextZ = 18;
  rng: Rng;
  private patternCount = 0;

  constructor(public seed: number) {
    this.rng = new Rng(seed);
  }

  /** multiplicateur de vitesse 1 → 2,5 en quelques minutes. */
  get speedFactor() {
    return Math.min(2.5, 1 + this.distance / 400);
  }

  update(dt: number, playerZ: number) {
    this.speed = 6 * this.speedFactor;
    const dz = this.speed * dt;
    this.distance += dz;
    for (const o of this.obstacles) o.z -= dz;
    for (const c of this.coins) c.z -= dz;
    for (const c of this.creatures) c.pos.z -= dz * 1.25;
    this.obstacles = this.obstacles.filter((o) => o.z + o.length > playerZ - 4);
    this.coins = this.coins.filter((c) => !c.taken && c.z > playerZ - 3);
    this.creatures = this.creatures.filter((c) => c.pos.z > playerZ - 4);
    this.nextZ -= dz;
    while (this.nextZ < 40) this.spawnPattern();
  }

  spawnPattern() {
    const sf = this.speedFactor;
    const ok = PATTERNS.filter((p) => p.minSpeed <= sf);
    // Les premiers motifs sont doux.
    const p = this.patternCount < 3 ? ok[this.patternCount % 3] : this.rng.pick(ok);
    this.patternCount++;
    const mirror = this.rng.chance(0.5);
    const gap = 2.2;
    const z0 = this.nextZ;
    p.rows.forEach((row, r) => {
      const z = z0 + r * gap;
      [...row].forEach((ch, i) => {
        const lane = mirror ? 2 - i : i;
        if (ch === "c") this.coins.push({ lane, z, y: 0.5, taken: false });
        else if (ch === "l") this.obstacles.push({ kind: "low", lane, z, length: 0.4, passed: false });
        else if (ch === "h") this.obstacles.push({ kind: "high", lane, z, length: 0.5, passed: false });
        else if (ch === "b") this.obstacles.push({ kind: "block", lane, z, length: 1.2, passed: false });
        else if (ch === "B" || ch === "S" || ch === "H") {
          const kind: CreatureKind = ch === "B" ? "blob" : ch === "S" ? "spider" : "hopper";
          this.creatures.push(makeCreature(kind, LANE_X[lane], z + 6, this.rng.int(0, 1000)));
        }
      });
    });
    this.nextZ = z0 + p.rows.length * gap + this.rng.range(5, 9) / Math.sqrt(sf);
  }
}

/** Vrai si une rangée laisse au moins une façon de passer (test de conception des motifs). */
export function rowHasExit(row: string): boolean {
  return [...row].some((ch) => ch === "." || ch === "c" || ch === "l" || ch === "h" || ch === "B" || ch === "S" || ch === "H");
}
