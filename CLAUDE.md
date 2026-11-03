# Nova Flipper : règles du projet

- Aucun asset binaire : plateau, lampes, bille et sons sont générés par le code.
- Un plateau = un fichier dans `src/table/` qui exporte un `TableDef` (géométrie via `build(w)`, lampes, plastiques, étiquettes, rampes, point d'éjection) et s'ajoute à `TABLES` dans `src/table/index.ts`. La coque commune (contour, lanceur, palettes, couloirs du bas) vient de `src/table/shell.ts`.
- Les règles ne connaissent les éléments que par leurs `tag` (bumper, sling, target, drop, lane, spinner, saucer, lock, orbit, liane, planet, peg, rampIn/Back/Top/Out). Un nouvel élément = un nouveau tag traité dans `src/game/game.ts`.
- Toute géométrie nouvelle doit laisser passer une bille de rayon 8 : aucun passage de moins de 18 unités, aucune surface plate horizontale où la bille peut se poser (incliner), les guides du bas rejoignent les pivots des palettes.
- Le test « les cinq plateaux » et le script de longue partie (Playwright) servent à détecter les billes coincées : les faire tourner après toute modification de plateau.
- Textes en français, scores formatés avec `fmt`.
