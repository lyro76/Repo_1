export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
export const TAU = Math.PI * 2;

export interface V3 {
  x: number;
  y: number;
  z: number;
}
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const len = (a: V3) => Math.hypot(a.x, a.y, a.z);

/** Interpolation exponentielle indépendante de la cadence : `rate` par seconde. */
export const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));

/**
 * IK à deux os dans un plan : renvoie le coude/genou pour atteindre `target`
 * depuis `root` avec des segments l1, l2. `bend` oriente la flexion.
 */
export function ik2(root: V3, target: V3, l1: number, l2: number, bend: V3): V3 {
  const d = sub(target, root);
  const real = Math.max(1e-6, len(d));
  const dir = scale(d, 1 / real);
  // Cible hors de portée : on tend la jambe vers elle sans la dépasser.
  const dist = clamp(real, 1e-4, l1 + l2 - 1e-4);
  // Loi des cosinus : distance du root au pied de la hauteur.
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // Perpendiculaire au segment, côté `bend`.
  let p = sub(bend, scale(dir, bend.x * dir.x + bend.y * dir.y + bend.z * dir.z));
  const pl = len(p);
  p = pl > 1e-6 ? scale(p, 1 / pl) : v3(0, 0, 1);
  return add(add(root, scale(dir, a)), scale(p, h));
}

/** Chaîne de points Verlet (cape, cheveux, queue). */
export class Chain {
  pts: V3[];
  prev: V3[];
  constructor(public n: number, public seg: number, origin: V3) {
    this.pts = Array.from({ length: n }, (_, i) => v3(origin.x, origin.y - i * seg, origin.z));
    this.prev = this.pts.map((p) => ({ ...p }));
  }
  step(anchor: V3, gravity: V3, wind: V3, dt: number, damping = 0.9) {
    const dt2 = dt * dt;
    for (let i = 1; i < this.n; i++) {
      const p = this.pts[i];
      const q = this.prev[i];
      const vx = (p.x - q.x) * damping, vy = (p.y - q.y) * damping, vz = (p.z - q.z) * damping;
      this.prev[i] = { ...p };
      p.x += vx + (gravity.x + wind.x) * dt2;
      p.y += vy + (gravity.y + wind.y) * dt2;
      p.z += vz + (gravity.z + wind.z) * dt2;
    }
    this.pts[0] = { ...anchor };
    for (let k = 0; k < 3; k++) {
      for (let i = 1; i < this.n; i++) {
        const a = this.pts[i - 1], b = this.pts[i];
        const d = sub(b, a);
        const l = len(d) || 1e-6;
        const corr = scale(d, (l - this.seg) / l);
        if (i === 1) {
          b.x -= corr.x; b.y -= corr.y; b.z -= corr.z;
        } else {
          a.x += corr.x / 2; a.y += corr.y / 2; a.z += corr.z / 2;
          b.x -= corr.x / 2; b.y -= corr.y / 2; b.z -= corr.z / 2;
        }
      }
    }
  }
}
