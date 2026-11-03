import { describe, it, expect } from "vitest";
import { World, seg, disc, flipper, flipperTip, BALL_R } from "../src/physics/world";
import { PLUNGER } from "../src/table/shell";
import { TABLES } from "../src/table";
const buildTable = (w: World) => TABLES[0].build(w);
import { Game, WHEEL, BALLS_PER_PLAYER, TH_DRAIN } from "../src/game/game";
import { WORLDS } from "../src/table/worlds";
import { blit, textWidth } from "../src/render/font";

const run = (w: World, seconds: number, dt = 1 / 120, cb?: () => void) => { for (let i = 0; i < seconds / dt; i++) { w.step(dt); cb?.(); } };

describe("physique", () => {
  it("une bille rebondit sur un mur horizontal sans le traverser", () => {
    const w = new World(); w.colliders.push(seg("floor", 0, 100, 400, 100, { e: 0.5 })); const b = w.addBall(200, 20);
    let minDist = 1e9; run(w, 1, 1 / 120, () => { minDist = Math.min(minDist, 100 - b.p.y); }); expect(minDist).toBeGreaterThan(BALL_R - 0.5); expect(b.p.y).toBeLessThan(100);
  });
  it("conserve une partie de l'énergie selon la restitution", () => {
    const w = new World(); w.colliders.push(seg("floor", 0, 300, 400, 300, { e: 0.8 })); const b = w.addBall(200, 100); let bounced = false, vAfter = 0;
    run(w, 1.2, 1 / 120, () => { if (!bounced && w.hits.length) { bounced = true; vAfter = -b.v.y; } }); expect(bounced).toBe(true); expect(vAfter).toBeGreaterThan(300); expect(vAfter).toBeLessThan(800);
  });
  it("un disque avec kick renvoie la bille à la vitesse du kick", () => {
    const w = new World(); w.colliders.push(disc("b", 200, 200, 17, { kick: 950, tag: "bumper" })); const b = w.addBall(200, 150, 0, 200);
    let hit = false, sp = 0; run(w, 0.5, 1 / 120, () => { if (w.hits.some((h) => h.tag === "bumper") && !hit) { hit = true; sp = Math.hypot(b.v.x, b.v.y); } }); expect(hit).toBe(true); expect(sp).toBeGreaterThan(900);
  });
  it("une palette en mouvement donne de la vitesse vers le haut", () => {
    const w = new World(); const f = flipper("f", 120, 700, 56, -1); w.colliders.push(f); const b = w.addBall(150, 680, 0, 50); w.step(1 / 60); f.pressed = true;
    let up = 0; run(w, 0.3, 1 / 240, () => { up = Math.min(up, b.v.y); }); expect(up).toBeLessThan(-600);
  });
  it("la barrière à sens unique laisse monter et bloque la descente", () => {
    const w = new World(); w.colliders.push(seg("gate", 100, 200, 300, 200, { gate: true })); const up = w.addBall(200, 260, 0, -800); run(w, 0.1); expect(up.p.y).toBeLessThan(200);
    const w2 = new World(); w2.colliders.push(seg("gate", 100, 200, 300, 200, { gate: true })); const down = w2.addBall(200, 150, 0, 300); run(w2, 0.4); expect(down.p.y).toBeLessThan(200);
  });
  it("extrémité de palette : à droite pour la gauche, à gauche pour la droite", () => {
    const l = flipperTip(flipper("l", 120, 700, 56, -1)), r = flipperTip(flipper("r", 252, 700, 56, 1)); expect(l.x).toBeGreaterThan(120); expect(r.x).toBeLessThan(252); expect(r.x - l.x).toBeGreaterThan(2 * BALL_R + 4);
  });
});

describe("plateau", () => {
  it("une bille lancée fort fait le tour de l'arc et redescend dans le jeu", () => {
    const w = new World(); buildTable(w); const b = w.addBall(PLUNGER.x, PLUNGER.y - 2, 0, -1900); let minY = 999, enteredField = false;
    run(w, 3, 1 / 120, () => { minY = Math.min(minY, b.p.y); if (b.p.x < 350 && b.p.y > 250) enteredField = true; }); expect(minY).toBeLessThan(60); expect(enteredField).toBe(true);
  });
  it("une bille qui tombe entre les palettes finit au drain", () => {
    const w = new World(); buildTable(w); const b = w.addBall(186, 600, 0, 0); run(w, 3); expect(b.p.y).toBeGreaterThan(TH_DRAIN);
  });
  it("la rampe : montée (niveau 1), sommet, sortie à droite (niveau 0)", () => {
    const w = new World(); buildTable(w); const b = w.addBall(108, 530, 0, -1500); const tags: string[] = [];
    run(w, 4, 1 / 120, () => { for (const s of w.sensed) tags.push(s.sensor.tag); }); expect(tags).toContain("rampIn"); expect(tags).toContain("rampTop"); expect(tags).toContain("rampOut"); expect(b.layer).toBe(0); expect(b.p.x).toBeGreaterThan(186);
  });
  it("une montée trop faible redescend par l'entrée et revient au niveau 0", () => {
    const w = new World(); buildTable(w); w.addBall(108, 530, 0, -500); const tags: string[] = [];
    run(w, 3, 1 / 120, () => { for (const s of w.sensed) tags.push(s.sensor.tag); }); expect(tags).toContain("rampIn"); expect(tags).not.toContain("rampTop"); expect(tags).toContain("rampBack"); expect(w.balls[0].layer).toBe(0);
  });
  it("le slingshot renvoie la bille", () => {
    const w = new World(); buildTable(w); w.addBall(90, 560, -300, 300); let kicked = false; run(w, 1, 1 / 120, () => { if (w.hits.some((h) => h.tag === "sling")) kicked = true; }); expect(kicked).toBe(true);
  });
});

describe("règles", () => {
  const silent = (g: Game) => { (g.sfx as unknown as { muted: boolean }).muted = true; return g; };
  it("1 à 6 joueurs, 3 billes chacun, rotation des joueurs", () => {
    const g = silent(new Game()); g.startGame(3); expect(g.players.length).toBe(3); expect(g.player.balls).toBe(BALLS_PER_PLAYER); expect(g.screen).toBe("play");
    g.endBall(); expect(g.current).toBe(1); g.endBall(); expect(g.current).toBe(2); g.endBall(); expect(g.current).toBe(0); expect(g.players[0].balls).toBe(2);
  });
  it("fin de partie quand plus personne n'a de bille, et classement", () => {
    const g = silent(new Game()); g.startGame(2); g.players[1].score = 500; for (let i = 0; i < 6; i++) g.endBall(); expect(g.screen).toBe("gameover"); expect(g.highScores[0].score).toBe(500);
  });
  it("bille supplémentaire : le même joueur rejoue", () => { const g = silent(new Game()); g.startGame(2); g.player.extraBalls = 1; g.endBall(); expect(g.current).toBe(0); expect(g.player.balls).toBe(3); });
  it("quatre secousses = tilt, palettes inactives", () => {
    const g = silent(new Game()); g.startGame(1); g.ballInPlunger = false; for (let i = 0; i < 4; i++) g.nudge(1); expect(g.screen).toBe("tilt"); expect(g.tilted).toBe(true); g.flip("L", true); expect(g.world.byId<import("../src/physics/world").Flipper>("flipL").pressed).toBe(false);
  });
  it("compléter N-O-V-A fait changer de monde et augmente le multiplicateur", () => {
    const g = silent(new Game()); g.startGame(1); const p = g.player; const s0 = p.score;
    for (const id of ["lane0", "lane1", "lane2", "lane3"]) (g as unknown as { onSensor(s: unknown, b: unknown): void }).onSensor({ id, tag: "lane" }, g.world.balls[0]);
    expect(g.screen).toBe("warp"); for (let i = 0; i < 300; i++) g.update(1 / 120); expect(g.screen).toBe("play"); expect(p.world).toBe(1); expect(WORLDS[p.world].mult).toBe(2); expect(p.score).toBeGreaterThan(s0); expect(g.world.balls.length).toBe(1); expect(g.world.colliders.some((c) => c.id === "volcano")).toBe(true);
  });
  it("le lancer dépend de la puissance accumulée", () => {
    const g = silent(new Game()); g.startGame(1); g.launch(true); for (let i = 0; i < 60; i++) g.update(1 / 120); g.launch(false); const v1 = -g.world.balls[0].v.y; expect(v1).toBeGreaterThan(700); expect(v1).toBeLessThan(2000);
  });
  it("la roue a 8 cases et chaque case a un effet", () => { expect(WHEEL.length).toBe(8); for (const w of WHEEL) expect(Boolean(w.pts || w.mult || w.extra || w.world || w.lock)).toBe(true); });
  it("une bille au drain est sauvée une seule fois, puis la bille est perdue", () => {
    const g = silent(new Game()); g.startGame(1); g.launch(true); g.launch(false); g.ballSave = 5; const b = g.world.balls[0]; b.p = { x: 186, y: TH_DRAIN + 5 }; b.v = { x: 0, y: 0 }; g.update(1 / 120); expect(g.saveUsed).toBe(true); expect(g.world.balls.length).toBe(1);
    g.ballInPlunger = false; g.ballSave = 5; g.world.balls[0].p = { x: 186, y: TH_DRAIN + 5 }; g.world.balls[0].v = { x: 0, y: 0 }; for (let i = 0; i < 200; i++) g.update(1 / 120); expect(g.player.balls).toBe(2);
  });
});

describe("afficheur", () => {
  it("la police couvre lettres accentuées et chiffres", () => { const grid = new Uint8Array(128 * 32); blit(grid, 128, 32, "SAUVÉE 1 000", 0, 0); expect(grid.reduce((a, b) => a + b, 0)).toBeGreaterThan(60); expect(textWidth("NOVA")).toBe(23); });
});

describe("les cinq plateaux", () => {
  it("ont des géométries différentes, des couloirs lettrés et une bille qui se joue sans erreur", () => {
    const ids = new Set<string>();
    for (const t of TABLES) {
      const w = new World(); t.build(w); const sig = w.colliders.map((c) => c.id).sort().join(","); expect(ids.has(sig)).toBe(false); ids.add(sig);
      expect(w.sensors.filter((s) => s.tag === "lane").length).toBe(t.lanes.length); expect(w.flippers().length).toBeGreaterThanOrEqual(2);
      expect(w.sensors.some((s) => s.tag === "saucer")).toBe(true); expect(w.sensors.some((s) => s.tag === "lock")).toBe(true); expect(w.colliders.some((c) => c.kind === "seg" && c.tag === "drop")).toBe(true);
      // la bille lancée fait le tour et finit par sortir ou rester en jeu sans sortir des murs
      const b = w.addBall(PLUNGER.x, PLUNGER.y - 2, 0, -1800); run(w, 8, 1 / 120, () => { expect(b.p.x).toBeGreaterThan(0); expect(b.p.x).toBeLessThan(400); expect(b.p.y).toBeGreaterThan(0); });
    }
  });
  it("Jungle a une palette supplémentaire côté droit, Cosmos un trou noir", () => { const w = new World(); TABLES[3].build(w); expect(w.flippers().filter((f) => f.side === 1).length).toBe(2); expect(TABLES[4].attractor).toBeDefined(); });
});
