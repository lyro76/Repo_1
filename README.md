# ClipStudio

Application web pour **enregistrer des vidéos en temps réel** (webcam, écran, micro),
les **monter** sur une timeline et les **exporter** pour les réseaux sociaux.
Tout tourne dans le navigateur, sans serveur.

## Installation

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173 dans Chrome ou Edge récent.

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement |
| `npm run build` | Vérification TypeScript + build de production |
| `npm run preview` | Sert le build de production |
| `npm test` | Tests unitaires (Vitest) |

## État d'avancement

- [x] Phase 1 : base du projet, mise en page, modèle de données, écran d'accueil
- [x] Phase 2 : studio de capture (webcam, écran, micro, composition, enregistrement)
