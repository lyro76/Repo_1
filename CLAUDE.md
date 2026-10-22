# Digital Arms — consignes pour Claude Code

Agent de bureau qui code et corrige des projets Rust/C++/Python avec un modèle local
compatible OpenAI, et l'API Claude en renfort. Lis `docs/ARCHITECTURE.md` avant un changement de fond.

## Commandes
- Build moteur + CLI : `cargo build` (le workspace exclut `src-tauri` par défaut)
- Tests : `cargo test` — `crates/da-core/tests/fix_loop.rs` lance de vrais `cargo build` avec un faux serveur LLM
- Lint : `cargo clippy --workspace --all-targets` doit rester sans avertissement
- App de bureau : `cargo tauri dev` (Linux : `libwebkit2gtk-4.1-dev`) ; vérif seule : `cargo build -p digital-arms`
- UI : `cd ui && npm run build` (tsc strict + vite) ; `npm run dev` = backend factice (`ui/src/demo.ts`)

## Règles
- Tout ce qui n'est pas de l'interface va dans `da-core`. `src-tauri` et `da-cli` ne font que brancher un `Host`.
- Un nouvel événement : `events.rs` → `ui/src/types.ts` → `onEvent` dans `ui/src/main.ts` → `demo.ts` si utile.
- Un nouvel outil d'agent : `tools.rs` (spec + `dispatch` + `label`). Sortie courte : les modèles locaux ont 16k de contexte.
- Un nouveau format d'erreur : un module dans `diag/`, une fixture **réelle** dans `tests/fixtures/`, un test.
- Le local reste prioritaire : pas d'appel API sans mode `api`/`auto` et clé présente.
- API Anthropic : HTTP brut dans `llm/anthropic.rs` (pas de SDK Rust officiel). Vérifier `stop_reason`
  avant de lire `content`, renvoyer `content` tel quel au tour suivant, pas de `temperature`.
- Textes visibles en français. Pas de `unwrap()` hors tests sauf invariant évident.
- Les fichiers du projet utilisateur passent par `tools::safe_path` (jamais hors de la racine).
