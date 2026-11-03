/** Données locales : séances, journal, réglages. Robuste aux refus de stockage (mode privé). */
export interface Session { m: string; t: number; s: number; v: number; d: number } // module, date ms, score 0-100, métrique, durée s
export interface Entry { day: string; mood?: number; intention?: string; thanks?: string[]; note?: string } // day = AAAA-MM-JJ
export interface Settings { muted: boolean; breath: number; ritualMinutes: number }
export interface Save { v: 1; sessions: Session[]; entries: Entry[]; settings: Settings }

const KEY = "esprit-clair.v1";
export const EMOTIONS = ["joie", "calme", "fierté", "curiosité", "tristesse", "colère", "peur", "fatigue"] as const;
export const EMOTION_HUES = [45, 170, 25, 200, 220, 0, 280, 240];

export function blank(): Save {
  return { v: 1, sessions: [], entries: [], settings: { muted: false, breath: 5, ritualMinutes: 5 } };
}

export function load(storage: Pick<Storage, "getItem"> | null = safeStorage()): Save {
  const base = blank();
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return base;
    const d = JSON.parse(raw) as Partial<Save>;
    return { ...base, ...d, settings: { ...base.settings, ...(d.settings ?? {}) }, sessions: d.sessions ?? [], entries: d.entries ?? [] };
  } catch { return base; }
}

export function persist(s: Save, storage: Pick<Storage, "setItem"> | null = safeStorage()) {
  try { storage?.setItem(KEY, JSON.stringify(s)); } catch { /* quota ou mode privé */ }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

export const dayKey = (t: number | Date = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function entryFor(s: Save, day = dayKey()): Entry {
  let e = s.entries.find((x) => x.day === day);
  if (!e) { e = { day }; s.entries.push(e); }
  return e;
}

export function addSession(s: Save, sess: Session) {
  s.sessions.push(sess);
  if (s.sessions.length > 5000) s.sessions.splice(0, s.sessions.length - 5000);
}
