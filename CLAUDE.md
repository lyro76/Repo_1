# Video Arms — consignes pour Claude Code

Application de bureau image → vidéo avec des modèles locaux (LTX-2, Wan…) sur GPU grand public.
Lis `docs/ARCHITECTURE.md` avant un changement de fond.

## Commandes
- Moteur : `cd engine && python -m pytest` (venv avec `pip install -e ".[dev]"` ; torch non requis pour les tests)
- Coque : `cargo build` ; app complète : `cargo tauri dev` (Linux : `libwebkit2gtk-4.1-dev`)
- UI : `cd ui && npm run build` ; `npm run dev` = backend factice (`ui/src/demo.ts`)
- Test de bout en bout sans GPU : lancer l'app avec un venv où le moteur est installé et choisir « Moteur factice »

## Règles
- Le moteur (`engine/videoarms`) ne dépend jamais de Tauri ; la coque ne connaît rien aux modèles.
  Ils se parlent uniquement par le protocole JSON de `protocol.py` (documenté en tête de fichier).
- Un nouveau backend : `backends/<nom>.py` avec `generate(job, emitter, cancel) -> Result`, enregistré
  dans `backends.get_backend` et détecté dans `models.py`. Il doit émettre les étapes (`Stage`) et la
  progression ; la stratégie mémoire passe par `memory.plan` + `torch_common.apply_plan`.
- Jamais de téléchargement de modèle, ni de dépendance aux nœuds ComfyUI, sans accord explicite.
- Tout ce qui est mesurable est mesuré et remonté (temps par étape, VRAM, RAM, stratégie).
- Textes visibles en français. Les erreurs du moteur arrivent à l'interface via `event: error`
  avec `message` lisible ; les traces vont dans le journal.
- Les tests ne doivent pas exiger torch : le moteur factice couvre le pipeline complet.
