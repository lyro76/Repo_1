/** Calculs purs pour l'onglet Statistiques et la carte du cerveau. */
import type { Save, Session } from "./store";
import { dayKey } from "./store";
import { MODULES } from "../modules";
import { REGIONS, type RegionId } from "./regions";

const DAY = 86400000;

export const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Jours ayant au moins une séance ou une entrée de journal. */
export function activeDays(s: Save): Set<string> {
  const set = new Set<string>();
  for (const x of s.sessions) set.add(dayKey(x.t));
  for (const e of s.entries) if (e.mood !== undefined || e.intention || e.thanks?.length) set.add(e.day);
  return set;
}

/** Série en cours (jours consécutifs jusqu'à aujourd'hui, ou jusqu'à hier si rien aujourd'hui). */
export function streak(s: Save, now = Date.now()): number {
  const days = activeDays(s);
  let t = dayStart(now), n = 0;
  if (!days.has(dayKey(t))) t -= DAY;
  while (days.has(dayKey(t))) { n++; t -= DAY; }
  return n;
}

export function sessionsPerDay(s: Save, nDays: number, now = Date.now()): { day: string; count: number; minutes: number }[] {
  const out = [] as { day: string; count: number; minutes: number }[];
  const start = dayStart(now) - (nDays - 1) * DAY;
  const map = new Map<string, { count: number; minutes: number }>();
  for (const x of s.sessions) { const k = dayKey(x.t); const o = map.get(k) ?? { count: 0, minutes: 0 }; o.count++; o.minutes += x.d / 60; map.set(k, o); }
  for (let i = 0; i < nDays; i++) { const k = dayKey(start + i * DAY); const o = map.get(k) ?? { count: 0, minutes: 0 }; out.push({ day: k, count: o.count, minutes: Math.round(o.minutes * 10) / 10 }); }
  return out;
}

export interface ModuleStat { id: string; name: string; count: number; best: number; last: number | null; avg7: number | null; recent: number[]; trend: number }

export function moduleStats(s: Save, now = Date.now()): ModuleStat[] {
  return MODULES.map((m) => {
    const list = s.sessions.filter((x) => x.m === m.id);
    const recent = list.slice(-10).map((x) => x.s);
    const last7 = list.filter((x) => now - x.t < 7 * DAY);
    const avg = (a: number[]) => (a.length ? a.reduce((p, c) => p + c, 0) / a.length : null);
    const first = recent.slice(0, Math.ceil(recent.length / 2)), second = recent.slice(Math.ceil(recent.length / 2));
    const trend = recent.length >= 4 ? (avg(second)! - avg(first)!) : 0;
    return { id: m.id, name: m.name, count: list.length, best: list.reduce((p, c) => Math.max(p, c.s), 0), last: list.length ? list[list.length - 1].s : null, avg7: avg(last7.map((x) => x.s)), recent, trend: Math.round(trend) };
  });
}

/** Score de région (0-100) sur 30 jours : moyenne des scores, pondérée par le nombre de séances (plafond à 5). */
export function regionScores(s: Save, now = Date.now()): Record<RegionId, { score: number; sessions: number }> {
  const out = {} as Record<RegionId, { score: number; sessions: number }>;
  for (const r of REGIONS) {
    const ids = MODULES.filter((m) => m.regions.includes(r.id)).map((m) => m.id);
    const list = s.sessions.filter((x) => ids.includes(x.m) && now - x.t < 30 * DAY);
    const avg = list.length ? list.reduce((p, c) => p + c.s, 0) / list.length : 0;
    out[r.id] = { score: Math.round(avg * Math.min(1, list.length / 5)), sessions: list.length };
  }
  return out;
}

/** Les deux régions les moins travaillées sur 7 jours → modules proposés pour le rituel. */
export function suggestModules(s: Save, n = 2, now = Date.now(), exclude: string[] = ["souffle"]): string[] {
  const counts = new Map<RegionId, number>();
  for (const r of REGIONS) counts.set(r.id, 0);
  for (const x of s.sessions) if (now - x.t < 7 * DAY) { const m = MODULES.find((mm) => mm.id === x.m); m?.regions.forEach((r) => counts.set(r, (counts.get(r) ?? 0) + 1)); }
  const candidates = MODULES.filter((m) => !exclude.includes(m.id) && m.scored);
  const lastPlayed = (id: string) => { const l = s.sessions.filter((x) => x.m === id); return l.length ? l[l.length - 1].t : 0; };
  const scored = candidates.map((m) => ({ id: m.id, need: Math.min(...m.regions.map((r) => counts.get(r) ?? 0)), last: lastPlayed(m.id) }));
  scored.sort((a, b) => a.need - b.need || a.last - b.last);
  const out: string[] = [], used = new Set<RegionId>();
  for (const c of scored) { const m = MODULES.find((mm) => mm.id === c.id)!; if (m.regions.some((r) => used.has(r)) && out.length < scored.length - n) continue; out.push(c.id); m.regions.forEach((r) => used.add(r)); if (out.length >= n) break; }
  return out;
}

export function moodSeries(s: Save, nDays: number, now = Date.now()): (number | null)[] {
  const start = dayStart(now) - (nDays - 1) * DAY;
  return Array.from({ length: nDays }, (_, i) => s.entries.find((e) => e.day === dayKey(start + i * DAY))?.mood ?? null);
}

export function totals(s: Save) {
  const minutes = s.sessions.reduce((p, c) => p + c.d, 0) / 60;
  const scores7 = s.sessions.filter((x) => Date.now() - x.t < 7 * DAY).map((x) => x.s);
  return { sessions: s.sessions.length, minutes: Math.round(minutes), avg7: scores7.length ? Math.round(scores7.reduce((p, c) => p + c, 0) / scores7.length) : null, days: activeDays(s).size };
}

export const bestOf = (s: Save, id: string): Session | null => s.sessions.filter((x) => x.m === id).reduce<Session | null>((p, c) => (!p || c.s > p.s ? c : p), null);
