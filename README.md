# ClipStudio

Application web pour **enregistrer des vidéos en temps réel** (webcam, écran, micro),
les **monter** sur une timeline et les **exporter** au bon format pour TikTok,
Instagram Reels, YouTube Shorts et YouTube.

Tout tourne dans le navigateur, sur votre ordinateur : aucun serveur distant, aucun envoi de fichiers.
Les projets et les médias restent enregistrés localement (IndexedDB).

Navigateurs cibles : **Chrome** et **Edge** récents.

## Lancement le plus simple (Python, sans Node.js)

L'application déjà compilée est incluse dans le dossier `dist/`.
Il suffit d'avoir **Python 3.8 ou plus récent** (https://www.python.org/downloads/,
cocher « Add python.exe to PATH » à l'installation).

- **Windows** : double-cliquez sur **`lancer.bat`**.
- **Toutes plateformes** : dans un terminal ouvert dans le dossier du projet :

  ```bash
  python lancer.py
  ```

Le navigateur s'ouvre sur http://localhost:5173 (Chrome ou Edge si disponibles).
Laissez la fenêtre du lanceur ouverte pendant l'utilisation ; Ctrl+C pour arrêter.

Ne pas ouvrir `index.html` par double-clic : l'application doit être servie par le lanceur.

## Installation pour le développement (Node.js)

Prérequis : Node.js 20.19+ ou 22.12+. Nécessaire seulement pour modifier le code.

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173.

`npm install` copie automatiquement le cœur de ffmpeg.wasm dans `public/ffmpeg/`
(script `scripts/copy-ffmpeg-core.mjs`), pour qu'il soit servi depuis la même origine.

### Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement (en-têtes COOP/COEP inclus) |
| `npm run build` | Vérification TypeScript stricte + build de production dans `dist/` (utilisé par `lancer.py`) |
| `npm run preview` | Sert le build de production (en-têtes COOP/COEP inclus) |
| `npm test` | Tests unitaires Vitest |
| `npm run typecheck` | Vérification TypeScript seule |

Après une modification du code, relancez `npm run build` et validez le dossier `dist/`
pour que `lancer.py` serve la nouvelle version.

### Déploiement

Le dossier `dist/` est statique. L'hébergeur doit envoyer ces deux en-têtes
(nécessaires à ffmpeg.wasm et déjà configurés pour `dev` et `preview` dans `vite.config.ts`) :

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Fonctionnalités

### Studio d'enregistrement
- Sources : webcam, partage d'écran ou de fenêtre (avec le son de l'écran), micro.
- Choix du périphérique pour la webcam et le micro, vumètre, coupure du micro.
- Composition en direct sur un canevas :
  - écran en plein cadre (entier sur fond flou, ou recadré) avec webcam incrustée ;
  - incrustation en cercle, coins arrondis ou carré, taille réglable,
    placement dans un coin ou par glisser-déposer sur l'aperçu ;
  - modes « webcam seule » et « écran seul », effet miroir.
- Formats 9:16 (1080×1920), 1:1 (1080×1080) et 16:9 (1920×1080).
- Titre et sous-titre en direct (couleur, position haut/centre/bas).
- Compte à rebours 3-2-1, pause et reprise.
- À l'arrêt, le clip est enregistré et **ajouté automatiquement à la fin de la timeline**.
- L'enregistrement continue même si l'onglet ClipStudio passe en arrière-plan
  (par exemple pendant que vous montrez une autre fenêtre).

### Timeline
- Pistes Vidéo, Texte et Audio, ajout et suppression de pistes, coupure du son par piste.
- Règle graduée, zoom avec Ctrl + molette (centré sur le pointeur), boutons de zoom
  et « ajuster », défilement horizontal.
- Tête de lecture déplaçable depuis la règle ou en cliquant sur une piste.
- Aimantation sur les bords des clips et la tête de lecture (désactivable,
  ou maintenir Alt pendant le glisser).
- Miniatures sur les clips vidéo et image, forme d'onde sur les clips audio.

### Édition
- Sélectionner, déplacer (y compris vers une autre piste du même type), supprimer, dupliquer.
- Couper à la tête de lecture : le clip sélectionné, sinon tous les clips sous la tête de lecture.
- Rogner en tirant les bords d'un clip.
- Volume par clip (0 à 200 %), coupure du son, vitesse 0.5x, 1x, 1.5x, 2x.
- Cadrage des vidéos et images : entier ou rempli.
- Transitions d'entrée et de sortie : fondu (enchaîné avec le clip voisin s'il est collé)
  et fondu au noir, avec durée réglable. Un bouton applique la transition des deux côtés
  d'une jonction.
- Textes : contenu, police, taille, couleur, contour, gras, fond, alignement,
  position (curseurs ou glisser directement sur l'aperçu), durée sur la timeline.
- Import de fichiers : vidéo (mp4, webm), audio (mp3, wav), image (png, jpg),
  par bouton ou glisser-déposer sur la bibliothèque ou directement sur une piste.
- Annuler / Rétablir jusqu'à 100 étapes : chaque geste continu
  (glisser, curseur, saisie) compte pour une seule étape.
- Aperçu de lecture synchronisé avec la timeline.

### Export
- Préréglages :
  - TikTok / Reels / Shorts : 1080×1920
  - Instagram carré : 1080×1080
  - YouTube : 1920×1080
- Qualité bonne ou haute, 30 ou 60 images par seconde.
- **WebM** rapide (VP9 + Opus) ou **MP4** H.264 + AAC via ffmpeg.wasm
  (yuv420p, cadence constante, `faststart`), lisible sur téléphone.
- Barre de progression, bouton annuler, téléchargement automatique et aperçu du résultat.
- Si le format du projet diffère du préréglage, la vidéo est placée avec des bandes noires.

### Projets
- Écran d'accueil listant les projets récents : créer, renommer, ouvrir, supprimer.
- Sauvegarde automatique dans IndexedDB : le projet en JSON, les médias en Blob.
- Le projet est retrouvé intact après fermeture et réouverture du navigateur.

## Raccourcis clavier

| Touche | Action |
| --- | --- |
| Espace | Lecture / pause |
| S | Couper à la tête de lecture |
| Suppr ou Retour arrière | Supprimer le clip sélectionné |
| Ctrl + Z | Annuler |
| Ctrl + Y (ou Ctrl + Maj + Z) | Rétablir |
| Ctrl + D | Dupliquer le clip sélectionné |
| ← / → | Reculer / avancer d'une image (Maj : d'une seconde) |
| Début / Fin | Aller au début / à la fin |
| Ctrl + molette | Zoom sur la timeline |
| R | Démarrer / arrêter l'enregistrement (studio) |
| P | Pause / reprise de l'enregistrement (studio) |
| ? | Afficher les raccourcis |

## Architecture

```
src/
  app/            App, mise en page de l'éditeur, barre supérieure, composants d'interface
  features/
    capture/      studio : sources, compositeur canvas, enregistreur MediaRecorder
    timeline/     pistes, clips, règle, miniatures et formes d'onde
    editor/       barre d'outils, panneaux Propriétés / Médias / Projet, actions, raccourcis
    preview/      lecteur : horloge, synchronisation des médias, rendu des images
    export/       rendu final, préréglages, conversion MP4 ffmpeg.wasm
    projects/     écran d'accueil et persistance
  store/          stores Zustand (projet + historique, lecture, interface, capture)
  lib/            utilitaires : temps, médias, IndexedDB, i18n, logique de timeline
  types/          types TypeScript (Project, Track, Clip...)
tests/            tests Vitest
```

Choix principaux :
- **Logique de timeline en fonctions pures** (`src/lib/timeline/`) : déplacement sans
  chevauchement, coupe, rognage, aimantation, vitesse, transitions, calculs de vue.
  Elles sont testées avec Vitest, comme l'historique et la géométrie du compositeur.
- **Un seul moteur de rendu** (`features/preview/renderFrame.ts` + `mediaPool.ts`)
  sert à l'aperçu et à l'export, ce qui garantit que l'export ressemble à l'aperçu.
- **Cadence par Web Worker** avec contre-pression pour la capture et l'export :
  pas de gel en arrière-plan, et pas de saturation sur une machine lente.
- **Textes de l'interface centralisés** dans `src/lib/i18n.ts`.

## Limites connues
- L'export est rendu en temps réel : il dure au moins la durée de la vidéo.
  Gardez l'onglet visible pendant l'export pour un résultat fluide.
- La conversion MP4 utilise ffmpeg.wasm en un seul fil d'exécution : comptez
  environ la durée de la vidéo en plus pour la conversion.
- Une transition « fondu » entre deux clips fige la dernière image du clip sortant
  (ou la première du clip entrant) pendant le fondu.
- Le stockage local dépend du navigateur : vider les données du site supprime les projets.
