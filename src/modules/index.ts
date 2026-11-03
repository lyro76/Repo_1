import type { ModuleDef } from "./types";
import { souffle } from "./souffle";
import { halo } from "./halo";
import { noeuds } from "./noeuds";
import { trame } from "./trame";
import { equilibre } from "./equilibre";
import { encre } from "./encre";
import { miroir } from "./miroir";
import { nuees } from "./nuees";
import { pulse } from "./pulse";
import { chemin } from "./chemin";
import { bascule } from "./bascule";
import { tours } from "./tours";
import { intrus } from "./intrus";
import { melodie } from "./melodie";
import { stop } from "./stop";
import { mains } from "./mains";

/** Les 16 exercices notés. Jardin et Météo vivent dans l'onglet Journal. */
export const MODULES: ModuleDef[] = [souffle, halo, noeuds, trame, equilibre, encre, miroir, nuees, pulse, chemin, bascule, tours, intrus, melodie, stop, mains];
export const moduleById = (id: string) => MODULES.find((m) => m.id === id);
export type { ModuleDef, ModuleInstance, ModuleResult, ModuleEnv } from "./types";
