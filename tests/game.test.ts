import { describe, expect, it } from "vitest";
import { Rng } from "../src/engine/rng";
import { recognize } from "../src/engine/input";
import { Chain, ik2, v3 } from "../src/engine/math";
import { Camera } from "../src/engine/project";
import { Character, COSTUMES, hipHeight } from "../src/char/skeleton";
import { PATTERNS, World, rowHasExit } from "../src/game/world";
import { Player } from "../src/game/player";
import { coinHit, creatureBox, obstacleBox, overlaps } from "../src/game/collision";
import { makeCreature } from "../src/char/creatures";

describe("rng", () => {
  it("est déterministe et dans [0,1)", () => {
    const a = new Rng(42), b = new Rng(42);
    const xs = Array.from({ length: 1000 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b.next()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
});

describe("gestes", () => {
  it("reconnaît tap et glissers", () => {
    expect(recognize(100, 100, 102, 101, 120)).toBe("tap");
    expect(recognize(100, 100, 102, 101, 600)).toBeNull();
    expect(recognize(100, 100, 140, 105, 90)).toBe("right");
    expect(recognize(100, 100, 60, 105, 90)).toBe("left");
    expect(recognize(100, 100, 103, 60, 90)).toBe("up");
    expect(recognize(100, 100, 103, 140, 90)).toBe("down");
  });
});

describe("maths", () => {
  it("IK respecte les longueurs", () => {
    const root = v3(0, 1, 0), target = v3(0.3, 0.45, 0.25);
    const knee = ik2(root, target, 0.42, 0.42, v3(0, 0, 1));
    const d = (a: typeof root, b: typeof root) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    expect(d(root, knee)).toBeCloseTo(0.42, 5);
    expect(d(knee, target)).toBeCloseTo(0.42, 5);
    expect(knee.z).toBeGreaterThan(0.1);
  });
  it("la chaîne verlet garde ses segments", () => {
    const ch = new Chain(5, 0.2, v3(0, 1, 0));
    for (let i = 0; i < 200; i++) ch.step(v3(Math.sin(i / 10), 1, 0), v3(0, -9.8, 0), v3(0, 0, -2), 1 / 60);
    for (let i = 1; i < 5; i++) expect(Math.hypot(ch.pts[i].x - ch.pts[i - 1].x, ch.pts[i].y - ch.pts[i - 1].y, ch.pts[i].z - ch.pts[i - 1].z)).toBeCloseTo(0.2, 1);
  });
  it("projette devant la caméra seulement", () => {
    const cam = new Camera(360, 640, 270);
    expect(cam.project(v3(0, 0, 0))).not.toBeNull();
    expect(cam.project(v3(0, 0, -5))).toBeNull();
    const near = cam.project(v3(1, 0, 0))!, far = cam.project(v3(1, 0, 30))!;
    expect(near.s).toBeGreaterThan(far.s);
    expect(far.y).toBeLessThan(near.y);
  });
});

describe("personnage", () => {
  it("a une pose cohérente dans chaque état", () => {
    const ch = new Character(COSTUMES[0]);
    for (const s of ["run", "jump", "slide", "hit", "idle"] as const) {
      ch.state = s;
      ch.update(1 / 60, 1, v3(0, 0, 0));
      const p = ch.pose;
      expect(p.head.y).toBeGreaterThan(p.hip.y - 0.01);
      expect(Number.isFinite(p.lKnee.x + p.rKnee.y + p.lElbow.z)).toBe(true);
      // Les pieds ne traversent pas le sol.
      expect(p.lFoot.y).toBeGreaterThanOrEqual(-0.01);
    }
  });
  it("les costumes changent les proportions", () => {
    expect(hipHeight(COSTUMES[3])).toBeLessThan(hipHeight(COSTUMES[0]));
    for (const c of COSTUMES) expect(new Character(c).height).toBeGreaterThan(1);
  });
  it("le ragdoll retombe au sol sans exploser", () => {
    const ch = new Character(COSTUMES[1]);
    ch.pos = v3(0, 1, 0);
    ch.startRagdoll(v3(2, 5, -3));
    for (let i = 0; i < 240; i++) ch.update(1 / 120, 0, v3(0, 0, 0));
    const j = ch.worldJoints();
    for (const k in j) {
      expect(Number.isFinite(j[k].x)).toBe(true);
      expect(j[k].y).toBeGreaterThan(-0.1);
      expect(j[k].y).toBeLessThan(5);
    }
  });
});

describe("monde", () => {
  it("chaque motif laisse une issue à chaque rangée", () => {
    for (const p of PATTERNS) for (const row of p.rows) expect(rowHasExit(row), `${p.name}: ${row}`).toBe(true);
  });
  it("génère de façon déterministe et accélère", () => {
    const a = new World(7), b = new World(7);
    for (let i = 0; i < 2000; i++) { a.update(1 / 60, 0); b.update(1 / 60, 0); }
    expect(a.obstacles.map((o) => [o.kind, o.lane, o.z.toFixed(3)])).toEqual(b.obstacles.map((o) => [o.kind, o.lane, o.z.toFixed(3)]));
    expect(a.speed).toBeGreaterThan(6);
    expect(a.obstacles.length + a.coins.length + a.creatures.length).toBeGreaterThan(0);
    expect(a.obstacles.every((o) => o.z > -5)).toBe(true);
  });
});

describe("joueur et collisions", () => {
  it("saute, glisse, change de voie", () => {
    const p = new Player(COSTUMES[0]);
    expect(p.apply("right")).toBe("lane");
    expect(p.targetLane).toBe(2);
    expect(p.apply("right")).toBeNull();
    expect(p.apply("tap")).toBe("jump");
    expect(p.ch.state).toBe("jump");
    let maxY = 0;
    for (let i = 0; i < 240; i++) { p.update(1 / 120, 1); maxY = Math.max(maxY, p.y); }
    expect(maxY).toBeGreaterThan(1.2);
    expect(p.y).toBe(0);
    expect(p.ch.state).toBe("run");
    expect(p.apply("down")).toBe("slide");
    expect(p.hitbox().yMax).toBeLessThan(0.7);
  });
  it("un obstacle bas se saute, un portique se glisse, un bloc non", () => {
    const p = new Player(COSTUMES[0]);
    p.update(1 / 60, 1);
    const low = obstacleBox({ kind: "low", lane: 1, z: -0.1, length: 0.4, passed: false });
    const high = obstacleBox({ kind: "high", lane: 1, z: -0.1, length: 0.5, passed: false });
    const block = obstacleBox({ kind: "block", lane: 1, z: -0.1, length: 1, passed: false });
    expect(overlaps(p.hitbox(), low)).toBe(true);
    p.y = 1.0;
    expect(overlaps(p.hitbox(), low)).toBe(false);
    expect(overlaps(p.hitbox(), block)).toBe(true);
    p.y = 0;
    expect(overlaps(p.hitbox(), high)).toBe(true);
    p.apply("down");
    expect(overlaps(p.hitbox(), high)).toBe(false);
    // Autre voie : rien.
    p.x = 1.6;
    expect(overlaps(p.hitbox(), low)).toBe(false);
  });
  it("une créature se saute, les pièces se ramassent", () => {
    const p = new Player(COSTUMES[0]);
    p.update(1 / 60, 1);
    const blob = makeCreature("blob", 0, 0, 3);
    expect(overlaps(p.hitbox(), creatureBox(blob))).toBe(true);
    p.y = 1.3;
    expect(overlaps(p.hitbox(), creatureBox(blob))).toBe(false);
    p.y = 0;
    expect(coinHit(p, { lane: 1, z: 0.2, y: 0.5, taken: false })).toBe(true);
    expect(coinHit(p, { lane: 0, z: 0.2, y: 0.5, taken: false })).toBe(false);
  });
});

describe("partie", () => {
  it("un joueur immobile finit par heurter quelque chose", async () => {
    const { Game } = await import("../src/game/game");
    const sfx = { jump() {}, slide() {}, lane() {}, coin() {}, hit() {}, land() {}, fanfare() {}, unlock() {}, muted: true } as any;
    let died = false;
    const g = new Game(3, COSTUMES[0], sfx, { onDeath: () => (died = true), onCoin: () => {} });
    g.start(3);
    let t = 0;
    while (!died && t < 60) { g.update(1 / 120); t += 1 / 120; }
    expect(died, `toujours vivant après ${t.toFixed(1)} s, obstacles=${g.world.obstacles.length}`).toBe(true);
    expect(t).toBeLessThan(30);
  });
});
