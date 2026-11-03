<p align="center"><img src="ui/public/logo.png" width="200" alt="ScreenComfy"></p>

# ScreenComfy

Application de bureau pour générer **vidéo, image, 3D et audio** avec les modèles installés sur ta
machine, sur un GPU grand public (10 Go de VRAM, beaucoup de RAM). Deux moteurs :

- **le moteur intégré** (diffusers) : LTX-2 / 2.3 (vidéo avec audio), Wan 2.2, SDXL et SD 1.5 ;
- **ComfyUI en arrière-plan** : n'importe quel workflow exporté depuis ComfyUI devient une tâche
  (LTX-2.5 GGUF, Hunyuan3D, ACE-Step…), sans ouvrir ComfyUI.

Et une **IA peut la piloter** : API locale + connecteur MCP, activés par une case à cocher.

![ScreenComfy](docs/capture.png)

## Ce qu'elle apporte

- **Brouillon → Final** : demi-résolution pour itérer, puis rendu définitif avec la même graine.
- **Mémoire décidée et mesurée** : tout sur le GPU, blocs streamés depuis la RAM, ou composant par
  composant, selon le modèle, la VRAM, la RAM et le nombre d'étapes. VAE tuilé dès 720p.
- **Profil de chaque génération** : temps par étape, secondes par pas, pic VRAM/RAM, stratégie.
  L'historique estime la durée des prochaines.
- **Modèles sous contrôle** : Charger / Décharger / Auto, modèle chargé affiché.
- **Workflows ComfyUI** : importe un fichier « Export (API) » ; l'app repère l'image, les prompts,
  la graine, la taille, la durée, et te dit quels nœuds manquent dans ton ComfyUI.
- **Pilotage par une IA** : une IA (Claude ou autre) lance des générations, charge des modèles, lit
  les résultats ; ce qu'elle fait s'affiche dans l'app, marqué « IA ».
- **Rien n'est téléchargé** : les modèles sont repérés sur le disque (caches Hugging Face,
  dossiers diffusers, `.safetensors`).

## Installer

1. Installateur dans **Releases** (`screencomfy-vX.Y.Z`).
2. **Python 3.10 à 3.13** sur la machine. L'app crée son propre environnement (torch, diffusers).
3. Réglages (⚙) : Python → **Installer le moteur** → dossier des modèles → Enregistrer.
4. Optionnel : dossier de ComfyUI pour les workflows ; case **Pilotage par une IA**.

## Piloter par une IA

Coche « Pilotage par une IA » dans les réglages. L'app ouvre une API locale (`http://127.0.0.1:8765`)
et affiche la commande du connecteur MCP, par exemple pour Claude Code :

```
claude mcp add screencomfy -- "C:\...\engine-venv\Scripts\python.exe" -m videoarms.mcp --url http://127.0.0.1:8765
```

L'IA dispose alors des outils `screencomfy_status`, `screencomfy_models`, `screencomfy_generate`,
`screencomfy_job`, `screencomfy_cancel`, `screencomfy_load`, `screencomfy_unload`,
`screencomfy_import_workflow`. Un jeton optionnel protège l'API.

Sans interface (headless), le même moteur et la même API :

```bash
python -m videoarms.api --port 8765 --paths "D:\modeles" --comfy-dir "C:\ComfyUI"
curl -X POST http://127.0.0.1:8765/jobs -d '{"task":"t2i","model":"<id>","prompt":"un phare"}'
```

## Utiliser sans l'interface

```bash
cd engine
python -m venv .venv && .venv/bin/pip install -e ".[models]" -r requirements-cuda.txt
.venv/bin/python -m videoarms.cli probe ~/modeles
.venv/bin/python -m videoarms.cli gen --model mock --image photo.jpg --prompt test   # sans GPU
```

## Organisation

| Dossier | Rôle |
|---|---|
| `engine/` | Moteur Python : backends (LTX-2, Wan, SD, ComfyUI, factice), mémoire, API HTTP, connecteur MCP |
| `src-tauri/` | Coque de bureau (Tauri 2) |
| `ui/` | Interface (TypeScript + Vite) |
| `docs/ARCHITECTURE.md` | Choix techniques et feuille de route |

Tests : `cd engine && python -m pytest` (moteur factice, faux serveur ComfyUI, API, MCP).

## Publier une version

Changer `"version"` dans `src-tauri/tauri.conf.json` (et `Cargo.toml`, `ui/package.json`,
`engine/pyproject.toml`) et pousser sur `screencomfy` : GitHub Actions construit les installateurs.
