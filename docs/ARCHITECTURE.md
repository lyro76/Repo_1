# Architecture

```
ui (TS) ──invoke/events──> src-tauri ──Host──> da-core::Agent ──> llm::Backend ──> Ollama / LM Studio / API Claude
                                                    │
                                                    ├── project   détection, commandes, exécution streamée
                                                    ├── diag      erreurs compilateur → Diagnostic
                                                    ├── edit      SEARCH/REPLACE, suggestions, instantanés
                                                    ├── tools     outils exposés au modèle + permissions
                                                    ├── index     arborescence, symboles tree-sitter, recherche
                                                    └── memory    NOTES.md, fixes.jsonl
```

## Deux boucles

**Tâche** (`Agent::task`) : boucle d'outils classique (lire, chercher, éditer, compiler, noter),
40 actions max. En Auto, si la demande ressemble à une création et qu'une clé API existe,
l'API écrit d'abord un plan court que le modèle local exécute : un petit modèle qui suit une
liste précise fait mieux qu'un petit modèle qui improvise. Si le local répète trois fois la
même action, on passe à l'API.

**Correction** (`Agent::fix`) — lancée seule ou après chaque tâche :
1. build ; les diagnostics sont parsés, jamais devinés ;
2. suggestions `MachineApplicable` de rustc appliquées sans modèle ; une suggestion incertaine
   unique est essayée puis annulée si elle n'améliore rien ;
3. le modèle reçoit erreurs + notes du compilateur + extrait de fichier + NOTES.md + correctifs
   passés semblables, et répond en blocs SEARCH/REPLACE (format texte, plus fiable qu'un appel
   d'outil pour un 7-14B) ; application exacte puis tolérante à l'indentation ;
4. rebuild ; `max_attempts` essais, puis escalade vers l'API en Auto.

## Modèles

- **Local** : `/v1/chat/completions` compatible OpenAI. Tool calling natif si le modèle le gère ;
  sinon (`text_tools = true`, ou automatiquement quand le modèle écrit l'appel dans son texte)
  protocole ```` ```json {"tool": …} ```` ````.
- **API** : `POST /v1/messages`, `claude-opus-5-5` par défaut, `output_config.effort`, prompt
  système mis en cache, `fallbacks: "default"` sur les modèles qui le permettent, refus gérés.

## Mémoire (3 couches)

1. **Index structurel** (v1) : `ignore` + tree-sitter (Rust, C/C++, Python) + regex. Reconstruit à la demande.
2. **NOTES.md** (v1) : lu à chaque tâche, enrichi par l'outil `note`.
3. **Épisodique** : `fixes.jsonl` erreur → diff. v1 : similarité lexicale (code d'erreur + mots).
   v2 : embeddings locaux (nomic-embed-code / bge) dans `sqlite-vec`, recherche hybride BM25 + vecteurs,
   5 à 8 extraits max — même fichier source, aucune migration.

## Feuille de route

- [ ] Streaming des réponses (SSE) dans la conversation
- [ ] Index incrémental sur sauvegarde (watcher) et cache sur disque
- [ ] Couche vectorielle (v2, voir ci-dessus)
- [ ] SARIF (gcc 15 / clang) en plus du JSON gcc et du texte
- [ ] Création de projet guidée : squelette déterministe puis plan API + remplissage local
- [ ] Réglages dans l'UI (aujourd'hui : `config.toml`)
