/**
 * Physique 2D du flipper : bille = disque, obstacles = segments, cercles, palettes (capsules en rotation).
 * Intégration en sous-pas (1/720 s) pour que la bille ne traverse rien même à grande vitesse.
 */
import { type V, v, add, sub, mul, dot, len, norm, clamp } from "../engine/vec";

export const BALL_R = 8;
export const GRAVITY = 1500;          // unités/s², composante de la pente de la table
export const MAX_SPEED = 2200;

export interface Ball { p: V; v: V; layer: number; id: number; alive: boolean; dead: boolean; spin: number; trail: V[] }

export interface Segment { kind: "seg"; id: string; a: V; b: V; layer: number; e: number; kick?: number; solid: boolean; enabled: boolean; tag?: string; gate?: boolean }
export interface Disc { kind: "disc"; id: string; c: V; r: number; layer: number; e: number; kick?: number; enabled: boolean; tag?: string }
export interface Flipper { kind: "flipper"; id: string; pivot: V; length: number; r: number; rest: number; up: number; angle: number; omega: number; side: -1 | 1; pressed: boolean; layer: number }
export type Collider = Segment | Disc | Flipper;

export interface Sensor { id: string; c: V; r: number; layer: number; tag: string; dir?: V; layerTo?: number } // dir : sens de passage requis (facultatif)

export interface Hit { id: string; tag?: string; speed: number; point: V; ball: Ball }

export const seg = (id: string, ax: number, ay: number, bx: number, by: number, o: Partial<Segment> = {}): Segment => ({ kind: "seg", id, a: v(ax, ay), b: v(bx, by), layer: 0, e: 0.45, solid: true, enabled: true, ...o });
export const disc = (id: string, cx: number, cy: number, r: number, o: Partial<Disc> = {}): Disc => ({ kind: "disc", id, c: v(cx, cy), r, layer: 0, e: 0.5, enabled: true, ...o });
export const flipper = (id: string, px: number, py: number, length: number, side: -1 | 1, rest = 0.52, up = -0.42): Flipper => ({ kind: "flipper", id, pivot: v(px, py), length, r: 7, rest, up, angle: rest, omega: 0, side, pressed: false, layer: 0 });

/** Polyligne → segments. */
export function poly(id: string, pts: [number, number][], o: Partial<Segment> = {}): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < pts.length - 1; i++) out.push(seg(`${id}.${i}`, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], o));
  return out;
}
/** Arc → polyligne (angles en radians, sens horaire en repère écran). */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 24): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number]; });
}

/** Extrémité et direction courante d'une palette. */
export function flipperTip(f: Flipper): V { const a = f.side === -1 ? f.angle : Math.PI - f.angle; return add(f.pivot, v(Math.cos(a) * f.length, Math.sin(a) * f.length)); }

export const FLIP_UP = 38, FLIP_DOWN = 22; // rad/s

export class World {
  colliders: Collider[] = [];
  sensors: Sensor[] = [];
  balls: Ball[] = [];
  hits: Hit[] = [];
  sensed: { sensor: Sensor; ball: Ball }[] = [];
  private inside = new Map<string, boolean>();
  private nextId = 1;
  nudge: V = v(0, 0);

  addBall(x: number, y: number, vx = 0, vy = 0, layer = 0): Ball { const b: Ball = { p: v(x, y), v: v(vx, vy), layer, id: this.nextId++, alive: true, dead: false, spin: 0, trail: [] }; this.balls.push(b); return b; }
  byId<T extends Collider>(id: string): T { return this.colliders.find((c) => c.id === id) as T; }
  flippers(): Flipper[] { return this.colliders.filter((c): c is Flipper => c.kind === "flipper"); }

  step(dt: number, substeps = 12) {
    this.hits = []; this.sensed = [];
    const h = dt / substeps;
    for (let s = 0; s < substeps; s++) {
      for (const f of this.flippers()) {
        const target = f.pressed ? f.up : f.rest, speed = f.pressed ? FLIP_UP : FLIP_DOWN;
        const d = target - f.angle, stepA = Math.sign(d) * Math.min(Math.abs(d), speed * h);
        f.omega = stepA / h; f.angle += stepA;
      }
      for (const b of this.balls) {
        if (!b.alive) continue;
        b.v.y += GRAVITY * h; b.v = add(b.v, mul(this.nudge, h));
        const sp = len(b.v); if (sp > MAX_SPEED) b.v = mul(b.v, MAX_SPEED / sp);
        b.p = add(b.p, mul(b.v, h));
        for (const c of this.colliders) this.collide(b, c);
      }
      this.nudge = mul(this.nudge, Math.exp(-h * 12));
    }
    for (const b of this.balls) {
      if (!b.alive) continue;
      b.trail.push(v(b.p.x, b.p.y)); if (b.trail.length > 8) b.trail.shift();
      for (const s of this.sensors) {
        const key = `${s.id}:${b.id}`, was = this.inside.get(key) ?? false, now = s.layer === b.layer && len(sub(b.p, s.c)) < s.r;
        if (now && !was && (!s.dir || dot(norm(b.v), s.dir) > 0.2)) { this.sensed.push({ sensor: s, ball: b }); if (s.layerTo !== undefined) b.layer = s.layerTo; }
        this.inside.set(key, now);
      }
    }
  }

  private collide(b: Ball, c: Collider) {
    if (c.kind === "seg") { if (!c.enabled || c.layer !== b.layer || (c.gate && b.v.y < 0)) return; this.hitSegment(b, c.a, c.b, c.e, c.id, c.tag, c.kick ?? 0, null); }
    else if (c.kind === "disc") { if (!c.enabled || c.layer !== b.layer) return;
      const d = sub(b.p, c.c), dist = len(d); if (dist >= c.r + BALL_R) return; const n = dist > 1e-6 ? mul(d, 1 / dist) : v(0, -1);
      b.p = add(c.c, mul(n, c.r + BALL_R)); const vn = dot(b.v, n); if (vn < 0) { b.v = sub(b.v, mul(n, (1 + c.e) * vn)); this.record(b, c.id, c.tag, -vn); }
      if (c.kick) { const sp = len(b.v); b.v = mul(n, Math.max(sp, c.kick)); } }
    else { if (c.layer !== b.layer) return; const tip = flipperTip(c); this.hitSegment(b, c.pivot, tip, 0.35, c.id, "flipper", 0, c); }
  }

  private hitSegment(b: Ball, a: V, bb: V, e: number, id: string, tag: string | undefined, kick: number, f: Flipper | null) {
    const ab = sub(bb, a), t = clamp(dot(sub(b.p, a), ab) / (dot(ab, ab) || 1), 0, 1), p = add(a, mul(ab, t));
    const d = sub(b.p, p), dist = len(d), r = BALL_R + (f ? f.r : 0); if (dist >= r) return;
    const n = dist > 1e-6 ? mul(d, 1 / dist) : norm(v(-ab.y, ab.x));
    b.p = add(p, mul(n, r));
    let vs = v(0, 0);
    if (f) { const rel = sub(p, f.pivot); const w = f.side === -1 ? f.omega : -f.omega; vs = mul(v(-rel.y, rel.x), w); }
    const vrel = sub(b.v, vs), vn = dot(vrel, n);
    if (vn < 0) {
      const tang = v(-n.y, n.x), vt = dot(vrel, tang);
      b.v = add(vs, add(mul(n, -e * vn), mul(tang, vt * 0.985)));
      if (kick) b.v = add(b.v, mul(n, kick));
      b.spin += vt * 0.002;
      this.record(b, id, tag, -vn, p);
    }
  }

  private record(b: Ball, id: string, tag: string | undefined, speed: number, point?: V) { this.hits.push({ id, tag, speed, point: point ?? b.p, ball: b }); }
}
