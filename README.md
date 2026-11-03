# Cavale

Runner mobile en **portrait, une main**, avec des personnages **100 % procéduraux** (aucun
asset : squelettes animés par code, costumes par paramètres). HTML5 + Canvas 2D, donc le même
code tourne dans un navigateur, en APK Android (Capacitor), et pourrait aller sur iOS ou PC.

- Glisser ← → : changer de voie · ↑ ou tap : sauter · ↓ : glisser.
- Obstacles : barrière basse (sauter), portique (glisser), bloc (changer de voie), créatures
  qui courent vers toi (blob sautillant, araignée, sauteur).
- Personnage : cycle de course, bras en opposition, IK des jambes, squash & stretch à
  l'atterrissage, inclinaison en changeant de voie, cape en chaîne de ressorts, clignement,
  ragdoll à la collision.
- Progression : vitesse qui monte, motifs générés à partir d'une graine (chaque rangée laisse
  toujours une issue, vérifié par test), pièces, costumes à débloquer, record sauvegardé.
- Sons synthétisés (WebAudio), rien à charger.

## Jouer

- Web : https://lyro76.github.io/Repo_1/ (GitHub Pages, branche `cavale`)
- Android : l'APK dans **Releases** (`cavale-vX.Y.Z`) ; APK de test signé en debug.

## Développer

```bash
npm install
npm run dev        # http://localhost:5173, aussi accessible depuis le téléphone sur le même réseau
npm test           # vitest : gestes, IK, monde, collisions, partie complète
npm run build
npx cap sync android && cd android && ./gradlew assembleDebug   # APK local (Android SDK requis)
```

Clavier sur PC : flèches ou WASD/ZQSD, espace pour sauter.

## Organisation

| Dossier | Rôle |
|---|---|
| `src/engine` | boucle à pas fixe, canvas en unités logiques, gestes tactiles, projection, audio, sauvegarde, PRNG |
| `src/char` | squelette procédural, dessin, créatures |
| `src/game` | monde et motifs, joueur, collisions, rendu, partie |
| `tests` | tests unitaires et de partie |
| `android` | projet Capacitor (généré, versionné pour régler orientation et icône) |
