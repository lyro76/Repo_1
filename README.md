# Nova Flipper

Flipper pour Android et navigateur, de 1 à 6 joueurs (3 billes chacun), avec **cinq plateaux différents** reliés par un portail, une roue bonus, le multibille, le tilt, et un afficheur à points façon années 90. Tout est dessiné et synthétisé par le code : aucun asset.

## Les cinq mondes (cinq plateaux)

| Monde | Multiplicateur | Ce qui change |
|---|---|---|
| **Néon** | ×1 | Rampe en boucle au-dessus de trois bumpers, banc de 3 cibles tombantes, 3 cibles fixes, spinner, trou « Roue Nova », verrou multibille. Couloirs N-O-V-A. |
| **Lave** | ×2 | Volcan central dont le cratère donne la roue, orbite droite qui passe derrière les couloirs, quatre bumpers en V, banc de 4 cibles tombantes, cibles fixes sur un mur incliné. Couloirs L-A-V-E. |
| **Glace** | ×3 | Champ de plots façon pachinko (25 points le plot), toit en V avec 4 cibles tombantes sous les couloirs, deux spinners latéraux, deux bumpers. Couloirs G-L-A-C-E. |
| **Jungle** | ×4 | Liane sinueuse (couloir serpentin, 2 000 points), deux gros bumpers, **palette supplémentaire en haut à droite** qui vise cinq cibles à gauche, 3 cibles tombantes. Couloirs J-U-N-G-L-E. |
| **Cosmos** | ×5 | Anneaux concentriques à ouvertures, quatre planètes (750), **trou noir qui attire la bille** (= roue), spinner, cibles. Couloirs C-O-S-M-O-S. |

On passe au monde suivant en allumant toutes les lettres des couloirs du haut : la bille est aspirée dans le **portail**, le plateau change, la bille ressort du trou d'arrivée du nouveau monde. Compléter le dernier monde donne le jackpot « NOVA ».

## Écrans

Menu (choix du nombre de joueurs, meilleurs scores sur l'afficheur), jeu (cinq plateaux), portail (transition entre mondes), roue bonus (8 cases : points, bonus ×2, bille supplémentaire, monde suivant, verrou), multibille (3 billes, rampe ou cible lit le jackpot, scores doublés), tilt, fin de partie avec classement.

## Règles

- **Lancer** : maintenir le bouton pour charger le ressort. Pendant 4 s, un couloir clignote : y entrer donne le **skill shot** (10 000).
- **Bille sauvée** une fois par bille pendant 8 s après le lancer.
- Bumper 100, slingshot 50, cible 500, cible tombante 1 000 (banc complet : 5 000 et verrou allumé), spinner 200 par tour, couloir 1 000, rampe 2 500 (combos ×2, ×3…), orbite 3 000, liane 2 000, planète 750.
- Les trois cibles fixes montent le **multiplicateur de bonus** (×2, ×3, ×4) appliqué en fin de bille aux couloirs et cibles tombantes, lui-même multiplié par celui du monde.
- **Verrou** : deux billes verrouillées (ou accordées par la roue) lancent le multibille.
- **Secouer** : les deux boutons rouges donnent une impulsion à la machine ; au quatrième coup, **TILT** (palettes mortes jusqu'à la perte de la bille, bonus perdu).

## Commandes

Barre du bas, de gauche à droite : palette gauche, secouer à gauche, lancer, secouer à droite, palette droite. Toucher le plateau lui-même actionne la palette du côté touché. Clavier : A ou Q (palette gauche), P ou M (palette droite), espace (lancer, maintenir pour la puissance), flèches gauche/droite (secouer), Échap (menu).

## Physique

Bille = disque, obstacles = segments, disques et palettes (capsules en rotation à vitesse angulaire réelle, qui transmettent leur vitesse de surface à la bille). 12 sous-pas par image à 120 Hz : la bille ne traverse rien même à pleine vitesse. Restitution par matériau (caoutchouc, métal, plastique), barrière à sens unique au sommet du couloir du lanceur, rampe sur un second niveau de collision, attracteur gravitationnel pour le trou noir.

## Développement

```
npm ci
npm run dev
npm test
npm run build
```

L'APK de test est produit par GitHub Actions et publié dans une release `flipper-vX.Y.Z` avec la version web zippée.
