/** Sauvegarde locale : meilleur score, pièces, costumes. Robuste aux refus (mode privé). */
export interface Save {
  best: number;
  coins: number;
  runs: number;
  unlocked: string[];
  costume: string;
  muted: boolean;
}

const KEY = "cavale.save.v1";

export function load(): Save {
  const base: Save = { best: 0, coins: 0, runs: 0, unlocked: ["base"], costume: "base", muted: false };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch {
    return base;
  }
}

export function save(s: Save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* mode privé ou quota : on continue sans sauvegarder */
  }
}
