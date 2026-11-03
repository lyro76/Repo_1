# ScreenComfy — consignes pour Claude Code

Application de bureau vidéo / image / 3D / audio avec des modèles locaux (moteur diffusers intégré)
ou des workflows ComfyUI exécutés en arrière-plan, pilotable par une IA (API HTTP + MCP).
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
- Jamais de téléchargement de modèle, ni d'installation de nœuds ComfyUI, sans accord explicite :
  l'app signale ce qui manque (`ComfyServer.missing_nodes`), elle n'installe pas.
- Les workflows ComfyUI sont des fichiers au format API ; `comfy/workflow.py` les analyse sans
  rien supposer du modèle. Tout nouveau type de sortie passe par `kind_of_outputs` et `Analysis.kind`.
- L'API HTTP (`api.py`) et le MCP (`mcp.py`) n'ont pas de dépendance : stdlib seulement. Tout ce
  qu'une IA lance passe par la même file et est visible dans l'interface (`origin`).
- Tout ce qui est mesurable est mesuré et remonté (temps par étape, VRAM, RAM, stratégie).
- Textes visibles en français. Les erreurs du moteur arrivent à l'interface via `event: error`
  avec `message` lisible ; les traces vont dans le journal.
- Les tests ne doivent pas exiger torch : le moteur factice couvre le pipeline complet.
