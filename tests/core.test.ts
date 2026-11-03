import { describe, it, expect } from "vitest";
import { Rng } from "../src/engine/rng";
import { blank, addSession, dayKey, load, persist, entryFor, type Save } from "../src/data/store";
import { streak, sessionsPerDay, moduleStats, regionScores, suggestModules, totals, moodSeries } from "../src/data/stats";
import { MODULES } from "../src/modules";
import { makeGraph, countCrossings, segmentsCross } from "../src/modules/noeuds";
import { polyomino, rot, mir, same } from "../src/modules/miroir";
import { makeMaze } from "../src/modules/chemin";
import { buildTree, heldDays } from "../src/ui/journal";
import { REGIONS } from "../src/data/regions";

const DAY = 86400000;
const withSessions = (days: number[], m = "souffle"): Save => { const s = blank(); for (const d of days) addSession(s, { m, t: Date.now() - d * DAY, s: 50 + d, v: 1, d: 60 }); return s; };

describe("rng", () => {
  it("est déterministe", () => { const a = new Rng(42), b = new Rng(42); expect([a.next(), a.next()]).toEqual([b.next(), b.next()]); });
  it("reste dans [0,1)", () => { const r = new Rng(7); for (let i = 0; i < 1000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); } });
});

describe("store", () => {
  it("charge un état vide sans stockage", () => { expect(load(null).sessions).toEqual([]); });
  it("survit à un JSON corrompu", () => { expect(load({ getItem: () => "{oops" }).entries).toEqual([]); });
  it("persiste et recharge", () => { const mem = new Map<string, string>(); const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }; const s = blank(); addSession(s, { m: "halo", t: 1, s: 80, v: 2, d: 60 }); entryFor(s, "2026-11-03").mood = 1; persist(s, st); const back = load(st); expect(back.sessions.length).toBe(1); expect(back.entries[0].mood).toBe(1); });
  it("borne l'historique", () => { const s = blank(); for (let i = 0; i < 5100; i++) addSession(s, { m: "halo", t: i, s: 1, v: 0, d: 1 }); expect(s.sessions.length).toBe(5000); });
});

describe("stats", () => {
  it("série de jours consécutifs", () => { expect(streak(withSessions([0, 1, 2]))).toBe(3); expect(streak(withSessions([1, 2]))).toBe(2); expect(streak(withSessions([2, 3]))).toBe(0); expect(streak(blank())).toBe(0); });
  it("le journal compte comme jour actif", () => { const s = blank(); entryFor(s, dayKey()).mood = 2; expect(streak(s)).toBe(1); });
  it("séances par jour sur N jours", () => { const d = sessionsPerDay(withSessions([0, 0, 3]), 7); expect(d.length).toBe(7); expect(d[6].count).toBe(2); expect(d[3].count).toBe(1); expect(d[6].minutes).toBe(2); });
  it("stats par module : record, dernier, tendance", () => { const s = blank(); [40, 42, 45, 44, 60, 65, 70, 72].forEach((sc, i) => addSession(s, { m: "encre", t: i, s: sc, v: 0, d: 60 })); const m = moduleStats(s).find((x) => x.id === "encre")!; expect(m.best).toBe(72); expect(m.last).toBe(72); expect(m.count).toBe(8); expect(m.trend).toBeGreaterThan(0); });
  it("score de région pondéré par la régularité", () => { const s = blank(); addSession(s, { m: "pulse", t: Date.now(), s: 100, v: 0, d: 60 }); expect(regionScores(s).cervelet.score).toBe(20); for (let i = 0; i < 4; i++) addSession(s, { m: "pulse", t: Date.now(), s: 100, v: 0, d: 60 }); expect(regionScores(s).cervelet.score).toBe(100); expect(regionScores(s).occipital.score).toBe(0); });
  it("suggère deux modules de régions différentes, jamais Souffle, en évitant les régions déjà travaillées", () => { const s = blank(); for (let i = 0; i < 5; i++) addSession(s, { m: "halo", t: Date.now(), s: 50, v: 0, d: 60 }); const p = suggestModules(s, 2); expect(p.length).toBe(2); expect(p).not.toContain("souffle"); expect(p).not.toContain("halo"); const r0 = MODULES.find((m) => m.id === p[0])!.regions, r1 = MODULES.find((m) => m.id === p[1])!.regions; expect(r0.some((r) => r1.includes(r))).toBe(false); });
  it("totaux et humeur", () => { const s = withSessions([0, 1]); entryFor(s, dayKey()).mood = 3; expect(totals(s).sessions).toBe(2); expect(totals(s).minutes).toBe(2); const ms = moodSeries(s, 3); expect(ms[2]).toBe(3); expect(ms[0]).toBeNull(); });
});

describe("modules", () => {
  it("16 modules, chacun relié à une région connue", () => { expect(MODULES.length).toBe(16); for (const m of MODULES) { expect(m.regions.length).toBeGreaterThan(0); for (const r of m.regions) expect(REGIONS.some((x) => x.id === r)).toBe(true); expect(m.duration).toBeGreaterThanOrEqual(30); } });
  it("chaque région est couverte par au moins un module ou le journal", () => { for (const r of REGIONS) { const ok = MODULES.some((m) => m.regions.includes(r.id)) || r.id === "ganglions"; expect(ok, r.id).toBe(true); } });
  it("Nœuds : le graphe généré est démêlable (positions en cercle → 0 croisement)", () => { const rng = new Rng(3); for (let k = 0; k < 20; k++) { const n = 5 + k % 8, g = makeGraph(n, rng); const circ = g.pts.map((_, i) => ({ x: 0.5 + 0.4 * Math.cos((i / n) * Math.PI * 2), y: 0.5 + 0.4 * Math.sin((i / n) * Math.PI * 2) })); expect(countCrossings(circ, g.edges)).toBe(0); } });
  it("segments : croisement détecté", () => { expect(segmentsCross({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 })).toBe(true); expect(segmentsCross({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBe(false); });
  it("Miroir : la pièce n'est jamais symétrique, rotation ≠ miroir", () => { const r = new Rng(11); for (let k = 0; k < 30; k++) { const c = polyomino(4 + (k % 4), () => r.next()); let m = mir(c), symmetric = false; for (let i = 0; i < 4; i++) { if (same(m, c)) symmetric = true; m = rot(m); } expect(symmetric).toBe(false); expect(same(rot(rot(rot(rot(c)))), c)).toBe(true); } });
  it("Chemin : labyrinthe parfait, toutes les cases atteignables", () => { const n = 7, w = makeMaze(n, new Rng(5)); const seen = new Set([0]), st = [0]; while (st.length) { const c = st.pop()!, x = c % n, y = Math.floor(c / n); [[0, 0, -1], [1, 1, 0], [2, 0, 1], [3, -1, 0]].forEach(([d, dx, dy]) => { if (!w[c][d]) { const k = (y + dy) * n + x + dx; if (!seen.has(k)) { seen.add(k); st.push(k); } } }); } expect(seen.size).toBe(n * n); expect(w[0][0] && w[0][3]).toBe(true); });
});

describe("jardin", () => {
  it("l'arbre grandit avec les jours tenus et reste déterministe", () => { expect(buildTree(0).length).toBeLessThan(buildTree(10).length); expect(buildTree(6, 1)).toEqual(buildTree(6, 1)); expect(buildTree(6, 1)).not.toEqual(buildTree(6, 2)); });
  it("compte les jours tenus", () => { const s = blank(); entryFor(s, "2026-01-01").mood = 0; entryFor(s, "2026-01-02"); entryFor(s, "2026-01-03").intention = "x"; expect(heldDays(s)).toBe(2); });
});
