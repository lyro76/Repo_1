/** Le coureur : voie, saut, glissade, collision, avec la machine à états du personnage. */

import { Character, type Costume } from "../char/skeleton";
import { clamp, damp, v3 } from "../engine/math";
import type { Gesture } from "../engine/input";
import { LANE_X } from "./world";

export class Player {
  ch: Character;
  lane = 1;
  targetLane = 1;
  x = 0;
  y = 0;
  vy = 0;
  slideT = 0;
  hitT = 0;
  dead = false;
  gravity = 24;
  jumpV = 8.4;
  z = 0;
  /** pour le feedback : vient d'atterrir */
  justLanded = false;

  constructor(costume: Costume) {
    this.ch = new Character(costume);
  }

  reset() {
    this.lane = this.targetLane = 1;
    this.x = 0; this.y = 0; this.vy = 0; this.slideT = 0; this.hitT = 0; this.dead = false;
    this.ch.state = "run"; this.ch.t = 0; this.ch.ragdoll = null; this.ch.lean = 0;
  }

  get airborne() {
    return this.y > 0.02;
  }

  apply(g: Gesture): "jump" | "slide" | "lane" | null {
    if (this.dead) return null;
    if (g === "left" && this.targetLane > 0) { this.targetLane--; return "lane"; }
    if (g === "right" && this.targetLane < 2) { this.targetLane++; return "lane"; }
    if ((g === "up" || g === "tap") && !this.airborne) {
      this.vy = this.jumpV;
      this.slideT = 0;
      this.setState("jump");
      return "jump";
    }
    if (g === "down") {
      if (this.airborne) this.vy = -this.jumpV * 1.2; // retombe vite
      this.slideT = 0.75;
      if (!this.airborne) this.setState("slide");
      return "slide";
    }
    return null;
  }

  setState(s: Character["state"]) {
    if (this.ch.state !== s) {
      this.ch.state = s;
      this.ch.t = 0;
    }
  }

  update(dt: number, speedFactor: number) {
    this.justLanded = false;
    const target = LANE_X[this.targetLane];
    const prevX = this.x;
    this.x = damp(this.x, target, 14, dt);
    // Inclinaison proportionnelle au déplacement latéral.
    this.ch.lean = damp(this.ch.lean, clamp((this.x - prevX) / Math.max(dt, 1e-3) * 0.06, -0.35, 0.35), 10, dt);
    this.lane = Math.abs(this.x - target) < 0.3 ? this.targetLane : this.lane;

    if (this.dead) {
      this.ch.update(dt, 0, v3(0, 0, 0));
      return;
    }
    // Verticale.
    if (this.airborne || this.vy > 0) {
      this.vy -= this.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0; this.vy = 0;
        this.ch.squash = 0.6;
        this.justLanded = true;
        this.setState(this.slideT > 0 ? "slide" : "run");
      }
    }
    if (this.slideT > 0 && !this.airborne) {
      this.slideT -= dt;
      if (this.slideT <= 0) this.setState("run");
    }
    this.ch.pos = v3(this.x, this.y, this.z);
    this.ch.cadence = 0.9 + speedFactor * 0.35;
    this.ch.update(dt, speedFactor, v3(0, 0, 0));
  }

  /** Boîte de collision selon l'état : hauteur réduite en glissade. */
  hitbox() {
    const sliding = this.ch.state === "slide";
    return { x: this.x, zMin: this.z - 0.25, zMax: this.z + 0.25, yMin: this.y, yMax: this.y + (sliding ? 0.55 : 1.6) };
  }

  die(impulseZ: number) {
    if (this.dead) return;
    this.dead = true;
    this.setState("hit");
    // Projeté en l'air et un peu vers l'avant : il reste dans le champ de la caméra.
    this.ch.startRagdoll(v3((Math.random() - 0.5) * 3, 5 + impulseZ * 0.2, 1.5));
  }
}
