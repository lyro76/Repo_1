# Architecture

```
ui (TS) ──invoke/events──► src-tauri (Rust) ──stdin/stdout JSON──► engine (Python)
                                 │                                    ├── models     repérage (HF cache, diffusers, GGUF)
                                 │                                    ├── memory     stratégie VRAM/RAM
                                 │                                    ├── backends   ltx2 · wan · sd · mock
                                 ├── python.rs  venv + pip            ├── video      ffmpeg : écriture, audio, post
                                 ├── engine.rs  processus             └── server     protocole, annulation
                                 └── settings   config.json, runs.jsonl
```

## Pourquoi un moteur Python séparé

Les modèles vivent dans l'écosystème PyTorch/diffusers, qui suit chaque nouvelle famille en
quelques jours. Le moteur est un paquet Python ordinaire (`videoarms`), lancé par l'app dans un
environnement qu'elle crée elle-même (`%LOCALAPPDATA%\video-arms\engine-venv`). L'app n'embarque
ni torch ni modèle : l'installateur reste petit, et le moteur se met à jour sans recompiler la coque.

## Le flux d'une génération

1. `probe` : machine (GPU, VRAM, RAM, torch, SageAttention) et modèles trouvés.
2. `generate` : le backend choisit la **stratégie mémoire** (`memory.plan`) :
   - `gpu` si modèle + activations tiennent dans 90 % de la VRAM ;
   - `group_offload` (blocs du transformer streamés depuis la RAM, préchargés sur un flux CUDA)
     si le modèle déborde, que la RAM suffit et qu'il y a peu d'étapes (distillé) ;
   - `cpu_offload` (un composant à la fois) sinon.
   Le VAE est tuilé dès 720p. L'encodeur de texte est renvoyé en RAM après l'encodage.
3. Étapes signalées : `load → encode → sample (progress par pas) → decode → write → post`.
4. `done` : chemin, timings, pics VRAM/RAM, plan mémoire, réglages effectifs. L'interface
   l'enregistre dans `runs.jsonl` ; c'est l'historique et la base d'estimation.

## Tâches et modèles

Un `Job` porte une `task` : `i2v`, `t2v` (LTX-2 et Wan, qui partagent leurs composants entre
les deux pipelines), `t2i`, `i2i` (Stable Diffusion XL / 1.5, dossier diffusers ou fichier
unique via `from_single_file`, famille déduite des clés de l'en-tête safetensors). Chaque
`ModelInfo` annonce ses `tasks` ; l'interface filtre la liste selon l'onglet et la source.

## Chargement des modèles

Le moteur garde un backend chargé entre deux générations (le rechargement d'un modèle de 20 Go
coûte plus que la génération d'un brouillon). Politique `auto_load` : en auto, un job qui demande
un autre modèle remplace le modèle chargé ; en manuel, il est refusé tant que l'utilisateur n'a
pas déchargé (commandes `load`, `unload`, `policy` ; événements `loaded`, `unloaded`).
Le déchargement libère réellement la VRAM (`torch_common.release`).

## Brouillon → final

Même formulaire, deux modes. Brouillon = demi-résolution (arrondie à 32). « Rendu final » reprend
le job du brouillon avec sa graine et double la résolution. La graine est visible et verrouillable.

## Ce qui n'est pas encore là

- **LTX-2.5 GGUF** (format ComfyUI) : détecté, pas exécuté. Piste : piloter ComfyUI en serveur
  via son API, ou charger le GGUF avec `gguf` + diffusers quand le support sera stable.
- **Comparateur qualité** brouillon/final (SSIM/LPIPS) et auto-réglage des caches (TeaCache/MagCache).
- **Interpolation/upscale par modèle** (RIFE, upscaler) : aujourd'hui ffmpeg sans modèle.
- **Mode flux** (Self-Forcing / Rolling Forcing) pour l'aperçu quasi temps réel.
- Vérification sur Windows avec les vrais modèles : les backends LTX-2 et Wan sont écrits d'après
  l'API diffusers 0.42 mais n'ont pas encore tourné sur GPU.
