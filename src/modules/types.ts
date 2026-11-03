import type { Env, Pointer } from "../engine/stage";
import type { Audio } from "../engine/audio";
import type { RegionId } from "../data/regions";

export interface ModuleEnv extends Env { audio: Audio; css: (n: string) => string; breath?: number }

export interface ModuleResult { score: number; metric: number; label: string }

export interface ModuleInstance {
  frame(dt: number, now: number): void;
  down?(p: Pointer): void;
  drag?(p: Pointer): void;
  up?(p: Pointer): void;
  /** texte court affiché en haut pendant la séance */
  status(): string;
  result(): ModuleResult;
  /** true quand le module se termine seul (Tours résolu) */
  finished?(): boolean;
}

export interface ModuleDef {
  id: string;
  name: string;
  regions: RegionId[];
  tagline: string;
  hint: string;
  /** durée d'une séance en secondes */
  duration: number;
  /** false pour Jardin et Météo (journal, pas de score) */
  scored: boolean;
  create(env: ModuleEnv): ModuleInstance;
}

export const pct = (ok: number, total: number) => (total ? Math.round((100 * ok) / total) : 0);
export const clamp100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
