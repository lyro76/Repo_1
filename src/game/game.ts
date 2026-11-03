/**
 * Règles du flipper : joueurs, billes, scores, modes, et la machine à états des écrans.
 * Écrans : menu → jeu (5 mondes) → roue bonus / multibille / tilt → fin de partie.
 */
import { World, BALL_R, type Ball, type Segment, type Hit, type Sensor } from "../physics/world";
import { PLUNGER } from "../table/shell";
import { TABLES, type TableDef } from "../table";
import { WORLDS } from "../table/worlds";
import { Sfx } from "../engine/audio";
import { v, len } from "../engine/vec";

export type Screen = "menu" | "play" | "bonus" | "multiball" | "tilt" | "warp" | "gameover";

export interface Player { score: number; balls: number; world: number; lanes: boolean[]; locks: number; extraBalls: number; bonusMult: number; drops: number }
export interface Msg { text: string; sub?: string; t: number }

export const BALLS_PER_PLAYER = 3;
export const WHEEL = [
  { label: "5 000", pts: 5000 }, { label: "X2 BONUS", mult: 1 }, { label: "25 000", pts: 25000 }, { label: "BILLE +", extra: true },
  { label: "10 000", pts: 10000 }, { label: "MONDE +", world: true }, { label: "50 000", pts: 50000 }, { label: "VERROU", lock: true },
];

export class Game {
  world = new World();
  sfx = new Sfx();
  screen: Screen = "menu";
  players: Player[] = [];
  current = 0;
  nPlayers = 1;
  time = 0;
  msgs: Msg[] = [];
  lamps = new Map<string, number>();   // id → 0 éteint, 1 allumé, 2 clignote
  flash = new Map<string, number>();   // effets visuels : id → temps restant
  plungerPower = 0; plungerHeld = false;
  ballInPlunger = false; ballSave = 0; saveUsed = false; tiltWarnings = 0; tilted = false;
  multiball = false; jackpot = 0; locked = 0;
  spinnerAngle = 0; spinnerSpeed = 0;
  wheelAngle = 0; wheelSpeed = 0; wheelStopped = false; wheelPrize = -1; bonusTimer = 0; heldBall: Ball | null = null;
  skillWindow = 0; skillLane = 0; combo = 0; comboTimer = 0;
  highScores: { name: string; score: number }[] = [];
  attractT = 0;
  endBallTimer = 0;
  shake = 0;
  private flipHeld = { L: false, R: false };
  warpT = 0; warpTo = 0;

  get table(): TableDef { return TABLES[this.player ? this.player.world : Math.floor(this.attractT / 5) % TABLES.length]; }
  loadTable(i: number) { this.world.colliders = []; this.world.sensors = []; TABLES[i].build(this.world); this.lamps.clear(); }

  constructor() { this.loadTable(0); this.resetLamps(); try { this.highScores = JSON.parse(localStorage.getItem("nova.hs") || "[]"); } catch { /* ignore */ } }

  get player() { return this.players[this.current]; }
  get theme() { return WORLDS[this.player ? this.player.world : Math.floor(this.attractT / 4) % WORLDS.length]; }
  private drops() { return this.world.colliders.filter((c): c is Segment => c.kind === "seg" && c.tag === "drop"); }
  get dropsLeft() { return this.drops().filter((d) => d.enabled).length; }

  say(text: string, sub?: string, t = 2) { this.msgs.push({ text, sub, t }); }

  // ----- écrans -----
  startGame(n: number) {
    this.nPlayers = n; this.players = Array.from({ length: n }, () => ({ score: 0, balls: BALLS_PER_PLAYER, world: 0, lanes: TABLES[0].lanes.map(() => false), locks: 0, extraBalls: 0, bonusMult: 1, drops: 0 }));
    this.current = 0; this.screen = "play"; this.locked = 0; this.loadTable(0); this.resetDrops(); this.newBall();
    this.say(n > 1 ? `JOUEUR 1` : "BONNE PARTIE", "LANCE LA BILLE", 2.5);
  }

  newBall() {
    this.world.balls = []; this.world.addBall(PLUNGER.x, PLUNGER.y - 2);
    this.ballInPlunger = true; this.plungerPower = 0; this.ballSave = 0; this.saveUsed = false; this.tiltWarnings = 0; this.tilted = false; this.multiball = false; this.skillWindow = 0; this.combo = 0;
    for (const f of this.world.flippers()) f.pressed = false;
    this.lamps.set("shoot", 2); this.lamps.set("saucer", 1); this.lamps.set("ramp", 1);
    this.resetDrops();
  }

  resetDrops() { for (const d of this.drops()) { d.enabled = true; this.lamps.set(d.id, 0); } }
  resetLamps() { this.lamps.clear(); }

  endBall() {
    const p = this.player;
    if (!this.tilted) { const bonus = p.lanes.filter(Boolean).length * 1000 + p.drops * 500; const total = bonus * p.bonusMult * WORLDS[p.world].mult; if (total) { p.score += total; this.say(`BONUS ${fmt(total)}`, `X${p.bonusMult * WORLDS[p.world].mult}`, 2); } }
    p.lanes = p.lanes.map(() => false); p.bonusMult = 1; p.drops = 0; this.lamps.set("x2", 0); this.lamps.set("x3", 0); this.lamps.set("x4", 0); p.lanes.forEach((_, i) => this.lamps.set(`lane${i}`, 0));
    if (p.extraBalls > 0) { p.extraBalls--; this.say("BILLE SUPPLÉMENTAIRE", "REJOUE", 2); this.lamps.set("extra", 0); this.newBall(); return; }
    p.balls--;
    // joueur suivant qui a encore des billes
    let next = this.current, tries = 0; do { next = (next + 1) % this.players.length; tries++; } while (this.players[next].balls <= 0 && tries <= this.players.length);
    if (this.players.every((q) => q.balls <= 0)) { this.gameOver(); return; }
    this.current = next; this.screen = "play"; this.loadTable(this.player.world); this.newBall(); this.say(this.players.length > 1 ? `JOUEUR ${next + 1}` : `BILLE ${BALLS_PER_PLAYER - this.player.balls + 1}`, this.players.length > 1 ? `BILLE ${BALLS_PER_PLAYER - this.player.balls + 1}` : "", 2.2);
  }

  gameOver() {
    this.screen = "gameover"; this.world.balls = [];
    const best = this.players.map((p, i) => ({ name: `J${i + 1}`, score: p.score }));
    this.highScores = [...this.highScores, ...best].sort((a, b) => b.score - a.score).slice(0, 5);
    try { localStorage.setItem("nova.hs", JSON.stringify(this.highScores)); } catch { /* ignore */ }
  }

  // ----- commandes -----
  flip(side: "L" | "R", down: boolean) {
    this.flipHeld[side] = down; if (this.screen !== "play" && this.screen !== "multiball") return;
    if (this.tilted) return;
    const fs = this.world.flippers().filter((f) => f.side === (side === "L" ? -1 : 1)); if (down && fs.some((f) => !f.pressed)) this.sfx.flipper(); for (const f of fs) f.pressed = down;
  }
  launch(down: boolean) {
    if (this.screen === "bonus") { if (down && !this.wheelStopped && this.wheelSpeed < 25) this.stopWheel(); return; }
    if (this.screen === "gameover") { if (down) this.screen = "menu"; return; }
    if (this.screen !== "play" && this.screen !== "multiball") return;
    if (!this.ballInPlunger) return;
    if (down) { this.plungerHeld = true; return; }
    if (!this.plungerHeld) return; this.plungerHeld = false;
    const b = this.world.balls.find((x) => x.p.x > 362); if (!b) return;
    const power = 700 + 1300 * Math.min(1, this.plungerPower); b.v = v(0, -power); this.ballInPlunger = false; this.plungerPower = 0; if (!this.saveUsed) this.ballSave = 8; this.skillWindow = 4; this.sfx.launch(); this.lamps.set("shoot", 0);
  }
  nudge(dir: -1 | 1) {
    if (this.screen !== "play" && this.screen !== "multiball" || this.tilted || this.ballInPlunger) return;
    this.world.nudge = v(dir * 2600, -900); this.shake = 0.25; this.sfx.nudge(); this.tiltWarnings++;
    if (this.tiltWarnings >= 4) { this.tilted = true; this.screen = "tilt"; this.sfx.tilt(); for (const f of this.world.flippers()) f.pressed = false; this.say("TILT", "", 3); }
    else this.say(this.tiltWarnings === 3 ? "ATTENTION" : "DOUCEMENT", "", 0.8);
  }

  // ----- boucle -----
  update(dt: number) {
    this.time += dt; this.attractT += dt; this.shake = Math.max(0, this.shake - dt);
    for (const m of this.msgs) m.t -= dt; this.msgs = this.msgs.filter((m) => m.t > 0);
    for (const [k, t] of this.flash) { if (t - dt <= 0) this.flash.delete(k); else this.flash.set(k, t - dt); }
    this.spinnerAngle += this.spinnerSpeed * dt; this.spinnerSpeed *= Math.exp(-dt * 1.8);
    if (this.screen === "menu" || this.screen === "gameover") { this.attract(dt); return; }
    if (this.screen === "tilt" && this.world.balls.length === 0) { this.endBallTimer += dt; if (this.endBallTimer > 1.2) { this.endBallTimer = 0; this.endBall(); } return; }
    if (this.screen === "bonus") { this.updateWheel(dt); return; }
    if (this.plungerHeld) this.plungerPower = Math.min(1, this.plungerPower + dt * 0.9);
    if (this.ballSave > 0) this.ballSave -= dt;
    if (this.skillWindow > 0) { this.skillWindow -= dt; const n = this.player.lanes.length; const sl = Math.floor(this.time * 1.5) % n; if (sl !== this.skillLane) { this.skillLane = sl; } this.player.lanes.forEach((on, i) => { if (!on) this.lamps.set(`lane${i}`, i === sl ? 2 : 0); }); if (this.skillWindow <= 0) this.player.lanes.forEach((on, i) => this.lamps.set(`lane${i}`, on ? 1 : 0)); }
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }
    if (this.ballInPlunger && !this.multiball) { this.lamps.set("shoot", 2); }
    // une bille retombée dans le couloir du lanceur redevient lançable
    if (!this.ballInPlunger && this.world.balls.some((b) => b.alive && b.p.x > 362 && b.p.y > 690 && Math.abs(b.v.y) < 30)) { this.ballInPlunger = true; this.plungerPower = 0; }
    if (this.screen === "warp") { this.warpT -= dt; if (this.warpT <= 0) { this.arrive(); } return; }
    const w = this.world; const at = this.table.attractor;
    if (at) for (const b of w.balls) { const dx = at.x - b.p.x, dy = at.y - b.p.y, d = Math.hypot(dx, dy); if (d < at.r && d > 1) { const k = (at.force * (1 - d / at.r)) * dt; b.v.x += (dx / d) * k; b.v.y += (dy / d) * k; b.v.x *= 1 - dt * 0.8; b.v.y *= 1 - dt * 0.8; } }
    w.step(dt);
    for (const h of w.hits) this.onHit(h);
    for (const s of w.sensed) this.onSensor(s.sensor, s.ball);
    // drains
    for (const b of w.balls) if (b.alive && b.p.y > TH_DRAIN) { b.alive = false; b.dead = true; this.onDrain(b); }
    w.balls = w.balls.filter((b) => b.alive);
    if (this.multiball && w.balls.length <= 1) { this.multiball = false; this.screen = this.tilted ? "tilt" : "play"; this.say("FIN MULTIBILLE", "", 1.5); }
    if (w.balls.length === 0) { this.endBallTimer += dt; if (this.endBallTimer > 1.2) { this.endBallTimer = 0; this.endBall(); } }
  }

  private attract(dt: number) {
    // chenillard de lampes pour l'écran d'accueil
    const ids = [...this.lamps.keys()]; void ids; const t = this.attractT;
    const all = ["laneN", "laneO", "laneV", "laneA", "drop0", "drop1", "drop2", "std0", "std1", "std2", "ramp", "ramp2", "saucer", "lock", "spinner", "inlaneL", "inlaneR", "outlaneL", "outlaneR", "extra", "x2", "x3", "x4", "shoot"];
    all.forEach((id, i) => this.lamps.set(id, Math.sin(t * 3 - i * 0.5) > 0.3 ? 1 : 0));
    this.spinnerSpeed = 6 + Math.sin(t) * 4; void dt;
  }

  private onDrain(b: Ball) {
    void b;
    if (this.multiball && this.world.balls.filter((x) => x.alive).length >= 1) { this.sfx.drain(); return; }
    if (this.ballSave > 0 && !this.tilted && !this.saveUsed) { this.saveUsed = true; this.say("BILLE SAUVÉE", "", 1.5); this.sfx.extra(); this.world.addBall(PLUNGER.x, PLUNGER.y - 2); this.ballInPlunger = true; this.ballSave = 0; return; }
    this.sfx.drain();
  }

  private score(pts: number) { if (this.tilted) return; const p = this.player; p.score += pts * WORLDS[p.world].mult * (this.multiball ? 2 : 1); }

  private onHit(h: Hit) {
    const p = this.player; if (!p) return;
    switch (h.tag) {
      case "bumper": this.score(100); this.flash.set(h.id, 0.15); this.sfx.bumper(); break;
      case "sling": this.score(50); this.flash.set(h.id, 0.12); this.sfx.sling(); break;
      case "target": { this.score(500); this.flash.set(h.id, 0.2); this.sfx.target(); const i = Number(h.id.slice(3)); this.lamps.set(`std${i}`, 1); if ([0, 1, 2].every((k) => this.lamps.get(`std${k}`) === 1)) { [0, 1, 2].forEach((k) => this.lamps.set(`std${k}`, 0)); this.score(5000); this.raiseMult(); } break; }
      case "drop": { const d = this.world.byId<Segment>(h.id); if (!d.enabled) break; d.enabled = false; p.drops++; this.score(1000); this.lamps.set(h.id, 1); this.sfx.drop(); this.flash.set(h.id, 0.3);
        if (this.dropsLeft === 0) { this.score(5000); this.say("BANC COMPLET", "+5000", 1.5); this.lamps.set("lock", 2); setTimeout(() => this.resetDrops(), 1500); } break; }
      case "planet": this.score(750); this.flash.set(h.id, 0.2); this.sfx.target(); break;
      case "peg": if (h.speed > 120) { this.score(25); this.sfx.spinner(); } break;
      case "volcano": if (h.speed > 300) { this.score(100); this.sfx.wall(h.speed); } break;
      case "flipper": break;
      case "plungerStop": break;
      default: if (h.speed > 250) this.sfx.wall(h.speed);
    }
  }

  private raiseMult() { const p = this.player; p.bonusMult = Math.min(4, p.bonusMult + 1); this.lamps.set(`x${p.bonusMult}`, 1); this.say(`BONUS X${p.bonusMult}`, "", 1.5); }

  private onSensor(s: Sensor, b: Ball) {
    const p = this.player; if (!p) return;
    switch (s.tag) {
      case "lane": { const i = Number(s.id.slice(4)); if (this.skillWindow > 0) { if (i === this.skillLane) { this.score(10000); this.say("SKILL SHOT", "+10 000", 1.5); this.sfx.jackpot(); } this.skillWindow = 0; p.lanes.forEach((on, k) => this.lamps.set(`lane${k}`, on ? 1 : 0)); } if (!p.lanes[i]) { p.lanes[i] = true; this.lamps.set(s.id, 1); this.score(1000); this.sfx.lane(); } else this.score(250);
        if (p.lanes.every(Boolean)) { p.lanes = p.lanes.map(() => false); p.lanes.forEach((_, k) => this.lamps.set(`lane${k}`, 0)); this.nextWorld(); } break; }
      case "orbit": this.score(3000); this.lamps.set(s.id, 1); this.flash.set(s.id, 0.4); this.sfx.lane(); this.say("ORBITE", "+3 000", 1); break;
      case "liane": this.score(2000); this.lamps.set("liane", 1); this.sfx.lane(); this.say("LIANE", "+2 000", 1); break;
      case "lianeOut": this.score(500); break;
      case "inlane": this.score(500); this.lamps.set(s.id, 1); this.sfx.lane(); break;
      case "outlane": this.score(1000); this.lamps.set(s.id, 1); break;
      case "spinner": { this.spinnerSpeed += Math.min(60, len(b.v) / 20); this.score(200 * Math.max(1, Math.round(len(b.v) / 400))); this.sfx.spinner(); this.lamps.set("spinner", 1); break; }
      case "rampIn": this.lamps.set("ramp", 2); break;
      case "rampBack": this.lamps.set("ramp", 1); break;
      case "rampTop": { this.combo++; this.comboTimer = 6; const pts = this.multiball ? 25000 : 2500 * this.combo; this.score(pts); this.sfx.jackpot(); this.lamps.set("ramp2", 1);
        this.say(this.multiball ? "JACKPOT" : this.combo > 1 ? `COMBO X${this.combo}` : "RAMPE", `+${fmt(pts * WORLDS[p.world].mult)}`, 1.5); if (this.multiball) this.jackpot++; break; }
      case "rampOut": this.lamps.set("ramp", 1); break;
      case "saucer": if (this.screen === "play" && !this.multiball) { this.enterBonus(b); } else { this.score(2500); this.eject(b); } break;
      case "lock": this.onLock(b); break;
    }
  }

  private nextWorld() {
    const p = this.player; this.score(10000);
    if (p.world >= WORLDS.length - 1) { this.score(50000); this.say("NOVA !", "+50 000", 2.5); this.sfx.jackpot(); this.flash.set("world", 1.2); return; }
    this.warpTo = p.world + 1; this.warpT = 2.2; this.screen = "warp"; this.sfx.world(); this.lamps.set("portal", 2);
    for (const b of this.world.balls) b.alive = false; this.world.balls = []; this.multiball = false;
    this.say(`PORTAIL`, `VERS ${WORLDS[this.warpTo].name}`, 2.2);
  }
  /** arrivée dans le monde suivant : nouvelle table, bille éjectée du trou d'arrivée */
  private arrive() {
    const p = this.player; p.world = this.warpTo; this.loadTable(p.world); this.resetDrops(); p.lanes = TABLES[p.world].lanes.map(() => false);
    const e = TABLES[p.world].eject; this.world.addBall(e.x, e.y, e.vx, e.vy); this.ballInPlunger = false; this.ballSave = 6; this.saveUsed = false;
    this.screen = "play"; this.say(`MONDE ${WORLDS[p.world].name}`, `MULTIPLICATEUR X${WORLDS[p.world].mult}`, 3); this.flash.set("world", 1.2); this.lamps.set("saucer", 1); this.lamps.set("ramp", 1); if (p.bonusMult > 1) this.lamps.set(`x${p.bonusMult}`, 1);
  }

  private onLock(b: Ball) {
    if (this.multiball) { this.score(5000); this.eject(b, "lock"); return; }
    this.locked++; this.sfx.target(); this.lamps.set("lock", this.locked >= 2 ? 2 : 1);
    if (this.locked >= 2) { this.locked = 0; this.startMultiball(b); return; }
    this.say(`BILLE ${this.locked} VERROUILLÉE`, "ENCORE UNE", 2); b.alive = false; this.world.balls = this.world.balls.filter((x) => x.alive);
    this.world.addBall(PLUNGER.x, PLUNGER.y - 2); this.ballInPlunger = true; this.ballSave = 10;
  }

  private startMultiball(b: Ball) {
    this.multiball = true; this.screen = "multiball"; this.jackpot = 0; this.say("MULTIBILLE", "RAMPE = JACKPOT", 3); this.sfx.world(); this.flash.set("world", 1.5); this.ballSave = 15;
    this.eject(b, "lock"); const e = this.table.eject; setTimeout(() => { if (this.multiball) this.world.addBall(e.x, e.y, e.vx - 150, e.vy); }, 600); setTimeout(() => { if (this.multiball) this.world.addBall(e.x, e.y, e.vx + 150, e.vy); }, 1400);
    this.lamps.set("ramp", 2); this.lamps.set("lock", 0);
  }

  private eject(b: Ball, from: "saucer" | "lock" = "saucer") { const e = this.table.eject; if (from === "saucer") { b.p = v(e.x, e.y); b.v = v(e.vx + (Math.random() - 0.5) * 200, e.vy); } else { const l = this.world.sensors.find((s) => s.tag === "lock")!; b.p = v(l.c.x + (l.c.x < 186 ? 18 : -18), l.c.y + 18); b.v = v(l.c.x < 186 ? 380 : -380, 420); } b.layer = 0; }

  // ----- écran bonus : la roue -----
  private enterBonus(b: Ball) { this.heldBall = b; b.alive = false; this.world.balls = this.world.balls.filter((x) => x.alive); this.screen = "bonus"; this.wheelAngle = Math.random() * Math.PI * 2; this.wheelSpeed = 14 + Math.random() * 6; this.wheelStopped = false; this.wheelPrize = -1; this.bonusTimer = 0; this.say("ROUE NOVA", "TOUCHE POUR ARRÊTER", 2.5); this.sfx.world(); this.lamps.set("saucer", 0); }
  private updateWheel(dt: number) {
    this.bonusTimer += dt;
    if (!this.wheelStopped) { this.wheelAngle += this.wheelSpeed * dt; this.wheelSpeed = Math.max(3, this.wheelSpeed - dt * 2.2); if (Math.floor(this.wheelAngle * 4) !== Math.floor((this.wheelAngle - this.wheelSpeed * dt) * 4)) this.sfx.wheel(); if (this.bonusTimer > 9) this.stopWheel(); }
    else if (this.bonusTimer > 2.4) { this.screen = this.multiball ? "multiball" : "play"; const e = this.table.eject; this.world.addBall(e.x, e.y, e.vx + (Math.random() - 0.5) * 200, e.vy); this.heldBall = null; this.lamps.set("saucer", 1); }
  }
  private stopWheel() {
    this.wheelStopped = true; this.bonusTimer = 0; const n = WHEEL.length; const idx = ((Math.floor(((-this.wheelAngle % (Math.PI * 2)) + Math.PI * 2) / (Math.PI * 2) * n)) % n + n) % n; this.wheelPrize = idx; const w = WHEEL[idx], p = this.player;
    if (w.pts) { this.score(w.pts); this.say(w.label, "POINTS", 2); this.sfx.jackpot(); }
    if (w.mult) { this.raiseMult(); }
    if (w.extra) { p.extraBalls++; this.lamps.set("extra", 1); this.say("BILLE SUPPLÉMENTAIRE", "", 2); this.sfx.extra(); }
    if (w.world) { this.nextWorld(); }
    if (w.lock) { this.locked = Math.min(2, this.locked + 1); this.lamps.set("lock", this.locked >= 2 ? 2 : 1); this.say("VERROU ACCORDÉ", this.locked >= 2 ? "TIRE LE VERROU" : "", 2); this.sfx.target(); }
  }
}

export const TH_DRAIN = 790;
export const fmt = (n: number) => n.toLocaleString("fr-FR").replace(/ | /g, " ");
export { BALL_R };
