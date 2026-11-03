# Esprit Clair

Entraînement quotidien de l'esprit, pour Android et navigateur : 16 exercices tactiles de concentration, réflexion et calme, un journal (Météo intérieure, intention, trois mercis, Jardin procédural), une carte du cerveau et un onglet Statistiques. Tout est procédural (aucun asset), hors ligne, sans compte ; les données restent sur le téléphone.

## Onglets

- **Aujourd'hui** : le rituel de 5 minutes (Souffle, deux exercices choisis pour les régions les moins travaillées de la semaine, puis journal).
- **Exercices** : les 16 modules, filtrables par région du cerveau, avec le record de chacun.
- **Cerveau** : indice par région sur 30 jours (moyenne des scores pondérée par la régularité).
- **Statistiques** : série en cours, jours actifs, calendrier de régularité (12 semaines), minutes par jour, radar des régions, tableau par exercice (record, dernier, dix derniers, tendance), météo intérieure sur 30 jours, export JSON, effacement.
- **Journal** : Jardin (arbre qui pousse avec les jours tenus), Météo intérieure, intention du matin, trois mercis du soir, note libre, historique.

## Modules et régions

| Module | Région principale | Mesure |
|---|---|---|
| Souffle | amygdale, insula | % en rythme |
| Halo | préfrontal, pariétal | secondes sans décrocher |
| Nœuds | pariétal | réseaux démêlés |
| Trame | préfrontal, hippocampe | motifs réussis |
| Équilibre | cervelet | secondes de calme |
| Encre (Stroop) | cingulaire antérieur | ms par bonne réponse |
| Miroir | pariétal | ms par bonne réponse |
| Nuées | pariétal | ratio le plus fin |
| Pulse | cervelet | ms d'écart moyen |
| Chemin | hippocampe | labyrinthes réussis |
| Bascule | préfrontal | coût du changement (ms) |
| Tours (Hanoï) | préfrontal | tours résolues |
| Intrus | occipital | degrés de teinte perçus |
| Mélodie | temporal, cortex auditif | notes mémorisées |
| Stop (Go/No-Go) | préfrontal | fausses alertes |
| Deux mains | cortex moteur, corps calleux | secondes à deux mains |

Chaque séance produit un indice sur 100, comparable d'un module à l'autre. L'attribution d'un module à une région est une simplification pédagogique : le cerveau travaille en réseaux.

## Développement

```
npm ci
npm run dev        # http://localhost:5173
npm test           # vitest
npm run build      # dist/
npx cap sync android && cd android && ./gradlew assembleDebug
```

L'APK de test est produit par GitHub Actions (workflow Android) et publié dans une release `esprit-clair-vX.Y.Z`, avec la version web zippée.
