/** Régions du cerveau (simplification pédagogique : le cerveau travaille en réseaux). */
export type RegionId = "prefrontal" | "cingulaire" | "parietal" | "occipital" | "temporal" | "hippocampe" | "cervelet" | "moteur" | "ganglions" | "limbique";

export interface Region { id: RegionId; name: string; short: string; role: string }

export const REGIONS: Region[] = [
  { id: "prefrontal", short: "préfrontal", name: "Cortex préfrontal", role: "planifier, inhiber, changer de règle, mémoire de travail" },
  { id: "cingulaire", short: "cingulaire", name: "Cortex cingulaire antérieur", role: "détection de conflit et d'erreur" },
  { id: "parietal", short: "pariétal", name: "Lobe pariétal", role: "espace, rotation mentale, sens du nombre" },
  { id: "occipital", short: "occipital", name: "Lobe occipital", role: "vision, discrimination fine" },
  { id: "temporal", short: "temporal", name: "Lobe temporal, cortex auditif", role: "sons, mélodies, mémoire auditive" },
  { id: "hippocampe", short: "hippocampe", name: "Hippocampe", role: "navigation, mémoire des lieux et des épisodes" },
  { id: "cervelet", short: "cervelet", name: "Cervelet", role: "timing, coordination, gestes fins" },
  { id: "moteur", short: "moteur", name: "Cortex moteur, corps calleux", role: "coordination des deux mains" },
  { id: "ganglions", short: "ganglions", name: "Ganglions de la base", role: "habitudes, répétition, récompense" },
  { id: "limbique", short: "limbique", name: "Amygdale, insula", role: "émotions, ressenti du corps, respiration" },
];

export const regionById = (id: RegionId) => REGIONS.find((r) => r.id === id)!;
