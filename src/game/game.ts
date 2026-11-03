/** Une partie : monde + joueur + score + effets, sans rien savoir du DOM. */

import { COSTUMES, type Costume } from "../char/skeleton";
import { updateCreature } from "../char/creatures";
import type { Gesture } from "../engine/input";
import type { Sfx } from "../engine/audio";
import { coinHit, creatureBox, obstacleBox, overlaps } from "./collision";
import { Player } from "./player";
import { World } from "./world";

export type Phase = "menu" | "running" | "paused" | "dead";

export interface Events {
  onDeath(score: number, coins: number): void;
  onCoin(total: number): void;
}

export class Game {
  world: World;
  player: Player;
  phase: Phase = "menu";
  coins = 0;
  time = 0;
  shake = 0;
  deathTimer = 0;
  speedFactor = 1;

  constructor(seed: number, costume: Costume, public sfx: Sfx, public events: Events) {
    this.world = new World(seed);
    this.player = new Player(costume);
    this.player.ch.state = "idle";
  }

  get score() {
    return Math.floor(this.world.distance);
  }

  start(seed: number) {
    this.world = new World(seed);
    this.player.reset();
    this.coins = 0;
    this.time = 0;
    this.shake = 0;
    this.phase = "running";
  }

  setCostume(id: string) {
    const c = COSTUMES.find((x) => x.id === id) ?? COSTUMES[0];
    this.player.ch.setCostume(c);
  }

  gesture(g: Gesture) {
    if (this.phase !== "running") return;
    const r = this.player.apply(g);
    if (r === "jump") this.sfx.jump();
    else if (r === "slide") this.sfx.slide();
    else if (r === "lane") this.sfx.lane();
  }

  update(dt: number) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 3);
    if (this.phase === "menu") {
      this.player.ch.update(dt, 0, { x: 0, y: 0, z: 0 });
      return;
    }
    if (this.phase === "dead") {
      this.deathTimer -= dt;
      this.player.update(dt, 0);
      for (const c of this.world.creatures) updateCreature(c, dt);
      if (this.deathTimer <= 0) {
        this.phase = "menu";
        this.events.onDeath(this.score, this.coins);
      }
      return;
    }
    if (this.phase !== "running") return;
    this.speedFactor = this.world.speedFactor;
    this.world.update(dt, this.player.z);
    for (const c of this.world.creatures) updateCreature(c, dt);
    this.player.update(dt, this.speedFactor);
    if (this.player.justLanded) this.sfx.land();

    const hb = this.player.hitbox();
    for (const c of this.world.coins) {
      if (!c.taken && coinHit(this.player, c)) {
        c.taken = true;
        this.coins++;
        this.sfx.coin();
        this.events.onCoin(this.coins);
      }
    }
    for (const o of this.world.obstacles) {
      if (overlaps(hb, obstacleBox(o))) return this.die();
    }
    for (const c of this.world.creatures) {
      if (overlaps(hb, creatureBox(c))) return this.die();
    }
  }

  die() {
    this.phase = "dead";
    this.deathTimer = 1.6;
    this.shake = 1;
    this.sfx.hit();
    this.player.die(this.world.speed);
  }
}
