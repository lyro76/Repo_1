/**
 * Personnage procédural : un squelette en 3D posé par du code selon son état
 * (course, saut, glissade, chute), puis projeté. Aucun asset.
 */

import { Chain, TAU, add, clamp, ik2, lerp, scale, v3, type V3 } from "../engine/math";

export interface Costume {
  id: string;
  name: string;
  price: number;
  skin: string;
  cloth: string;
  cloth2: string;
  hair: string;
  cape: string | null;
  hat: "none" | "cap" | "horns" | "crown" | "halo";
  /** proportions */
  height: number;
  bulk: number;
  legs: number;
  headSize: number;
  eyes: string;
}

export const COSTUMES: Costume[] = [
  { id: "base", name: "Coureur", price: 0, skin: "#f1c9a5", cloth: "#2f6df6", cloth2: "#1b2a5b", hair: "#3a2416", cape: null, hat: "none", height: 1, bulk: 1, legs: 1, headSize: 1, eyes: "#111" },
  { id: "cape", name: "Vigilante", price: 60, skin: "#e2b48d", cloth: "#c62828", cloth2: "#2b2b2b", hair: "#111", cape: "#8e0f0f", hat: "none", height: 1.05, bulk: 1.1, legs: 1, headSize: 0.95, eyes: "#fff" },
  { id: "robot", name: "Automate", price: 120, skin: "#9fb3c8", cloth: "#5b6b7f", cloth2: "#2c3440", hair: "#9fb3c8", cape: null, hat: "none", height: 1.1, bulk: 1.3, legs: 0.9, headSize: 1.1, eyes: "#5ef2ff" },
  { id: "imp", name: "Lutin", price: 200, skin: "#7cc06a", cloth: "#2e7d32", cloth2: "#1b5e20", hair: "#1b5e20", cape: null, hat: "horns", height: 0.8, bulk: 0.9, legs: 1.1, headSize: 1.25, eyes: "#ffd600" },
  { id: "king", name: "Monarque", price: 400, skin: "#f1c9a5", cloth: "#6a1b9a", cloth2: "#311b92", hair: "#e0e0e0", cape: "#ffd700", hat: "crown", height: 1, bulk: 1.15, legs: 1, headSize: 1, eyes: "#111" },
  { id: "ghost", name: "Spectre", price: 800, skin: "#e8f0ff", cloth: "#cfd8ff", cloth2: "#9fa8da", hair: "#e8f0ff", cape: "#e8f0ff", hat: "halo", height: 1.05, bulk: 0.8, legs: 1.05, headSize: 1.05, eyes: "#3f51b5" },
];

export type State = "run" | "jump" | "slide" | "hit" | "idle";

export interface Pose {
  hip: V3;
  chest: V3;
  neck: V3;
  head: V3;
  lShoulder: V3; rShoulder: V3;
  lElbow: V3; rElbow: V3;
  lHand: V3; rHand: V3;
  lHip: V3; rHip: V3;
  lKnee: V3; rKnee: V3;
  lFoot: V3; rFoot: V3;
  /** 0..1, écrasement à l'atterrissage (y) / étirement en l'air */
  squash: number;
  lean: number;
}

/** Longueurs de base (unités monde ; un personnage fait ~1,8 de haut). */
const B = { thigh: 0.42, shin: 0.42, upperArm: 0.3, foreArm: 0.28, torso: 0.5, neck: 0.1, head: 0.22, hipW: 0.16, shW: 0.24 };

export class Character {
  state: State = "run";
  /** temps dans l'état */
  t = 0;
  /** phase de course (radians) */
  phase = 0;
  /** vitesse de course normalisée (1 = cadence de base) */
  cadence = 1;
  pos: V3 = v3(0, 0, 0);
  vy = 0;
  lean = 0;
  squash = 0;
  cape: Chain | null = null;
  blink = 0;
  pose: Pose;
  /** chute : points verlet pour chaque articulation */
  ragdoll: { pts: V3[]; prev: V3[] } | null = null;

  constructor(public costume: Costume, public seed = 0) {
    this.pose = this.computePose(0);
    if (costume.cape) this.cape = new Chain(7, 0.13, v3(0, 1.3, 0));
  }

  get height() {
    return 1.8 * this.costume.height;
  }

  setCostume(c: Costume) {
    this.costume = c;
    this.cape = c.cape ? new Chain(7, 0.13, add(this.pos, v3(0, 1.3, 0))) : null;
  }

  update(dt: number, speed: number, wind: V3) {
    this.t += dt;
    if (this.state === "run" || this.state === "jump" || this.state === "slide") this.phase += dt * (this.state === "run" ? 9 * this.cadence * (0.7 + speed * 0.3) : 2);
    this.blink = this.blink > 0 ? this.blink - dt : Math.random() < dt * 0.3 ? 0.12 : 0;
    this.squash = lerp(this.squash, 0, Math.min(1, dt * 12));
    this.pose = this.computePose(this.phase);
    if (this.ragdoll) this.stepRagdoll(dt);
    if (this.cape) this.cape.step(add(this.pos, scale(this.pose.neck, this.costume.height)), v3(0, -9, -6 - speed * 4), wind, dt, 0.92);
  }

  /** La pose dans le repère du personnage (pieds à y=0, face à +z). */
  computePose(ph: number): Pose {
    const c = this.costume;
    const H = c.height;
    const legL = B.thigh * c.legs, shinL = B.shin * c.legs;
    const groundY = 0;
    const hipY = (legL + shinL) * 0.96;
    const s = this.state;
    let hip = v3(0, hipY, 0);
    let bob = 0;
    let lFoot: V3, rFoot: V3, lHand: V3, rHand: V3;
    const torsoLean = s === "run" ? 0.25 : s === "slide" ? 1.25 : s === "jump" ? 0.1 : 0;

    if (s === "run") {
      const a = Math.sin(ph), b = Math.sin(ph + Math.PI);
      bob = Math.abs(Math.cos(ph)) * 0.06;
      hip.y += bob;
      // Pied : avance/recul en z, se lève quand il revient.
      const stride = 0.45 * c.legs;
      const lift = (v: number) => Math.max(0, -Math.sin(v)) * 0.22 * c.legs;
      lFoot = v3(-B.hipW, groundY + lift(ph), a * stride);
      rFoot = v3(B.hipW, groundY + lift(ph + Math.PI), b * stride);
      lHand = v3(-B.shW * 1.1, hipY + 0.35 + b * 0.15, b * 0.3 + 0.05);
      rHand = v3(B.shW * 1.1, hipY + 0.35 + a * 0.15, a * 0.3 + 0.05);
    } else if (s === "jump") {
      const k = clamp(this.t * 3, 0, 1);
      hip.y += 0.05;
      lFoot = v3(-B.hipW, groundY + 0.35 * k, 0.25 * k);
      rFoot = v3(B.hipW, groundY + 0.15 * k, -0.2 * k);
      lHand = v3(-B.shW * 1.4, hipY + 0.9 * k, 0.1);
      rHand = v3(B.shW * 1.4, hipY + 0.9 * k, 0.1);
    } else if (s === "slide") {
      hip = v3(0, 0.3, 0.1);
      lFoot = v3(-B.hipW, 0.05, 0.75);
      rFoot = v3(B.hipW, 0.05, 0.55);
      lHand = v3(-B.shW * 1.3, 0.25, -0.35);
      rHand = v3(B.shW * 1.3, 0.55, 0.3);
    } else if (s === "hit") {
      hip = v3(0, hipY * 0.9, -0.2);
      lFoot = v3(-B.hipW, 0.1, -0.3);
      rFoot = v3(B.hipW, 0.0, 0.2);
      lHand = v3(-B.shW * 1.5, hipY + 0.6, -0.3);
      rHand = v3(B.shW * 1.5, hipY + 0.7, -0.3);
    } else {
      const breath = Math.sin(this.t * 2) * 0.015;
      hip.y += breath;
      lFoot = v3(-B.hipW * 1.2, 0, 0.05);
      rFoot = v3(B.hipW * 1.2, 0, -0.05);
      lHand = v3(-B.shW * 1.2, hipY - 0.05 + breath, 0.05);
      rHand = v3(B.shW * 1.2, hipY - 0.05 + breath, 0.05);
    }

    const chest = add(hip, v3(0, B.torso * Math.cos(torsoLean), B.torso * Math.sin(torsoLean)));
    const neck = add(chest, v3(0, B.neck, 0.02));
    const head = add(neck, v3(0, B.head * 0.8 * c.headSize, 0.04));
    const lShoulder = add(chest, v3(-B.shW * c.bulk, 0, 0));
    const rShoulder = add(chest, v3(B.shW * c.bulk, 0, 0));
    const lHip = add(hip, v3(-B.hipW, 0, 0));
    const rHip = add(hip, v3(B.hipW, 0, 0));
    const kneeBend = v3(0, 0, 1);
    const elbowBend = v3(0, 0, -1);
    const pose: Pose = {
      hip, chest, neck, head, lShoulder, rShoulder,
      lElbow: ik2(lShoulder, lHand, B.upperArm, B.foreArm, elbowBend),
      rElbow: ik2(rShoulder, rHand, B.upperArm, B.foreArm, elbowBend),
      lHand, rHand, lHip, rHip,
      lKnee: ik2(lHip, lFoot, legL, shinL, kneeBend),
      rKnee: ik2(rHip, rFoot, legL, shinL, kneeBend),
      lFoot, rFoot,
      squash: this.squash,
      lean: this.lean,
    };
    // Échelle globale de taille.
    if (H !== 1) for (const k of Object.keys(pose) as (keyof Pose)[]) {
      const v = pose[k];
      if (typeof v === "object") pose[k] = scale(v, H) as never;
    }
    return pose;
  }

  /** Points du squelette dans le monde, après écrasement, inclinaison et position. */
  worldJoints(): Record<string, V3> {
    const p = this.pose;
    const out: Record<string, V3> = {};
    const sq = 1 - this.squash * 0.35;
    const wide = 1 + this.squash * 0.25;
    for (const k of Object.keys(p) as (keyof Pose)[]) {
      const v = p[k];
      if (typeof v !== "object") continue;
      // Inclinaison latérale lors d'un changement de voie : rotation autour de z au niveau des pieds.
      const c = Math.cos(this.lean), s = Math.sin(this.lean);
      const x = v.x * wide, y = v.y * sq;
      out[k] = v3(this.pos.x + x * c - y * s, this.pos.y + x * s + y * c, this.pos.z + v.z);
    }
    if (this.ragdoll) {
      const names = Object.keys(out);
      names.forEach((n, i) => (out[n] = this.ragdoll!.pts[i]));
    }
    return out;
  }

  startRagdoll(impulse: V3) {
    const j = this.worldJoints();
    const pts = Object.values(j).map((p) => ({ ...p }));
    this.ragdoll = { pts, prev: pts.map((p) => v3(p.x - impulse.x * 0.02, p.y - impulse.y * 0.02, p.z - impulse.z * 0.02)) };
  }

  private stepRagdoll(dt: number) {
    const r = this.ragdoll!;
    const names = Object.keys(this.pose).filter((k) => typeof (this.pose as any)[k] === "object");
    const idx = (n: string) => names.indexOf(n);
    const bones: [string, string][] = [["hip", "chest"], ["chest", "neck"], ["neck", "head"], ["chest", "lShoulder"], ["chest", "rShoulder"], ["lShoulder", "lElbow"], ["lElbow", "lHand"], ["rShoulder", "rElbow"], ["rElbow", "rHand"], ["hip", "lHip"], ["hip", "rHip"], ["lHip", "lKnee"], ["lKnee", "lFoot"], ["rHip", "rKnee"], ["rKnee", "rFoot"], ["lShoulder", "rShoulder"], ["lHip", "rHip"], ["hip", "lShoulder"], ["hip", "rShoulder"]];
    const rest = bones.map(([a, b]) => {
      const pa = (this.pose as any)[a] as V3, pb = (this.pose as any)[b] as V3;
      return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z) || 0.01;
    });
    for (let i = 0; i < r.pts.length; i++) {
      const p = r.pts[i], q = r.prev[i];
      const vx = (p.x - q.x) * 0.98, vy = (p.y - q.y) * 0.98, vz = (p.z - q.z) * 0.98;
      r.prev[i] = { ...p };
      p.x += vx; p.y += vy - 9.8 * dt * dt; p.z += vz;
      if (p.y < 0.05) { p.y = 0.05; r.prev[i].x = p.x - vx * 0.5; r.prev[i].z = p.z - vz * 0.5; }
    }
    for (let k = 0; k < 4; k++) bones.forEach(([a, b], i) => {
      const pa = r.pts[idx(a)], pb = r.pts[idx(b)];
      const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
      const l = Math.hypot(dx, dy, dz) || 1e-6;
      const corr = (l - rest[i]) / l / 2;
      pa.x += dx * corr; pa.y += dy * corr; pa.z += dz * corr;
      pb.x -= dx * corr; pb.y -= dy * corr; pb.z -= dz * corr;
    });
  }
}

/** Petite aide pour les tests : hauteur du bassin au repos. */
export const hipHeight = (c: Costume) => (B.thigh + B.shin) * c.legs * 0.96 * c.height;
export { TAU };
