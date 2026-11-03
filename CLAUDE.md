# Esprit Clair : règles du projet

- Aucun asset binaire : tout est dessiné sur canvas ou synthétisé (audio). Les icônes Android sont générées par script.
- Un module = un fichier dans `src/modules/`, qui exporte un `ModuleDef` (id, nom, régions, durée, `create(env)`), ajouté à `MODULES` dans `src/modules/index.ts`. Un module ne touche jamais au DOM : il dessine dans `env.ctx` et reçoit les pointeurs via `down/drag/up`.
- `result()` renvoie un score 0-100 (via `clamp100`) et une métrique lisible : c'est ce que l'onglet Statistiques compare.
- Les calculs de statistiques sont des fonctions pures dans `src/data/stats.ts`, testées dans `tests/core.test.ts`.
- Les données locales passent par `src/data/store.ts` (`load/persist`), toujours tolérantes à un stockage absent.
- Textes en français, tutoiement, phrases courtes.
- `npm test` et `npm run build` doivent passer avant chaque commit.
