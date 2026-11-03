# Cavale — consignes pour Claude Code

Runner mobile HTML5/Canvas 2D, personnages procéduraux, emballé en APK par Capacitor.

## Commandes
- `npm test` (vitest), `npm run build` (tsc strict + vite), `npm run dev`
- Captures au format téléphone : Playwright avec `devices["Pixel 7"]` sur `vite preview`
- APK : `npx cap sync android && cd android && ./gradlew assembleDebug` (GitHub Actions le fait aussi)

## Règles
- Aucun asset binaire : personnages, décors, sons sont générés par code. Un nouveau costume est une
  entrée de `COSTUMES` ; une nouvelle créature est une démarche dans `creatures.ts`.
- Le jeu (`src/game/game.ts`) ne touche jamais au DOM ; `main.ts` branche l'interface.
- Les gestes passent par `engine/input.ts` ; les cibles tactiles font au moins 48 px CSS.
- Tout motif ajouté à `PATTERNS` doit laisser une issue par rangée (test `rowHasExit`).
- Textes visibles en français.
