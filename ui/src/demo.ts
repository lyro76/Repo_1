// Backend factice pour développer l'interface dans un navigateur.
// Rejoue le scénario de la maquette : build cassé, correctif local, demande de dépendance.

import type { Backend } from "./api";
import type { AgentEvent, ApprovalRequest, Config, ProjectInfo, PullProgress } from "./types";

const config: Config = {
  mode: "auto",
  local: { base_url: "http://localhost:11434/v1", model: "qwen2.5-coder:14b", text_tools: false, context_tokens: 16384 },
  api: { model: "claude-opus-5-5", effort: "high", base_url: "https://api.anthropic.com" },
  max_attempts: 3,
  max_steps: 40,
  auto_fix: true,
  fix_tests: true,
  confirm_writes: false,
  build_cmd: null,
  test_cmd: null,
};

const NOTES = "# Notes du projet\n\n## Commandes\n- Build : `cargo build`\n\n## Conventions\n- Pas de unwrap() dans net/\n- Erreurs : 3 essais max\n";

const projects: Record<string, ProjectInfo> = {
  "moteur-rust": {
    tab: "moteur-rust", name: "moteur-rust", root: "~/projets/moteur-rust", lang: "rust", lang_name: "Rust", lang_label: "rs", test: "cargo test",
    files: ["src/main.rs", "src/config.rs", "src/parser.rs", "src/net/client.rs", "tests/config.rs", "Cargo.toml", "NOTES.md"],
    notes: NOTES, config, build: "cargo build --message-format=json", feed: null,
  },
  "sim-cpp": {
    tab: "sim-cpp", name: "sim-cpp", root: "~/projets/sim-cpp", lang: "cpp", lang_name: "C/C++ (CMake)", lang_label: "cpp", test: null,
    files: ["src/main.cpp", "src/body.hpp", "src/body.cpp", "CMakeLists.txt", "NOTES.md"],
    notes: "# Notes du projet\n\n## Commandes\n- Build : `cmake --build build`\n", config, build: "cmake --build build", feed: null,
  },
  "vision-py": {
    tab: "vision-py", name: "vision-py", root: "~/projets/vision-py", lang: "python", lang_name: "Python", lang_label: "py", test: "pytest -x -q",
    files: ["src/vision/__init__.py", "src/vision/detect.py", "tests/test_detect.py", "pyproject.toml", "NOTES.md"],
    notes: "# Notes du projet\n\n## Commandes\n- Tests : `pytest -x -q`\n", config, build: "python3 -m compileall -q .", feed: null,
  },
};

const DIFF = `--- src/config.rs
+++ src/config.rs
@@ -56,5 +56,5 @@
 pub fn load(path: &Path) -> Result<Config> {
     let raw = fs::read_to_string(path)?;
-    timeout: raw.timeout,
+    timeout: raw.timeout.as_secs() as u32,
     retries: raw.retries,
 }`;

type Step = [number, AgentEvent | { approval: ApprovalRequest }];

const firstHalf: Step[] = [
  [300, { type: "step_start", id: 1, label: "cargo build" }],
  [100, { type: "terminal", line: "~/moteur-rust $ cargo build", stream: "agent" }],
  [250, { type: "terminal", line: "   Compiling moteur v0.3.1", stream: "stderr" }],
  [500, { type: "terminal", line: "error[E0308]: mismatched types", stream: "stderr" }],
  [0, { type: "terminal", line: "  --> src/config.rs:58:19", stream: "stderr" }],
  [0, { type: "terminal", line: "error[E0599]: no method named `as_u32` found", stream: "stderr" }],
  [0, { type: "terminal", line: "  --> src/net/client.rs:112:30", stream: "stderr" }],
  [100, { type: "step_end", id: 1, summary: "2 erreurs", ok: false }],
  [0, { type: "build", ok: false, errors: 2, seconds: 2.1 }],
  [0, {
    type: "diagnostics", items: [
      { file: "src/config.rs", line: 58, column: 19, level: "error", code: "E0308", message: "mismatched types", notes: ["expected u32, found Duration"], suggestions: [] },
      { file: "src/net/client.rs", line: 112, column: 30, level: "error", code: "E0599", message: "no method named `as_u32` found", notes: [], suggestions: [] },
    ],
  }],
  [0, { type: "terminal", line: "agent › 2 erreurs capturées, correction en cours (local)", stream: "agent" }],
  [400, { type: "step_start", id: 2, label: "lecture src/config.rs:41-72" }],
  [500, { type: "step_end", id: 2, summary: "local", ok: true }],
  [200, { type: "usage", backend: "local", calls: 1 }],
  [300, { type: "step_start", id: 3, label: "édition src/config.rs" }],
  [600, { type: "patch", snapshot: "demo-1", file: "src/config.rs", diff: DIFF, attempt: 2, backend: "local" }],
  [0, { type: "step_end", id: 3, summary: "+3 -1", ok: true }],
  [300, { type: "step_start", id: 4, label: "cargo build" }],
  [100, { type: "terminal", line: "~/moteur-rust $ cargo build", stream: "agent" }],
  [300, { type: "terminal", line: "   Compiling moteur v0.3.1", stream: "stderr" }],
  [700, { type: "terminal", line: "    Finished `dev` profile [unoptimized] target(s) in 1.80s", stream: "stderr" }],
  [0, { type: "step_end", id: 4, summary: "OK · 1,8 s", ok: true }],
  [0, { type: "build", ok: true, errors: 0, seconds: 1.8 }],
  [300, { type: "text", text: "Le build échouait sur `config.rs:58` : un `u32` était attendu là où une `Duration` était passée. J'ai converti avec `as_secs()`, le détail est dans le panneau Correction. Pour le timeout configurable, j'ai besoin d'une dépendance." }],
  [300, { approval: { id: 1, title: "Installer une dépendance ?", detail: "cargo add tokio --features time", rule: "cargo add" } }],
];

const secondHalf: Step[] = [
  [200, { type: "step_start", id: 5, label: "cargo add tokio --features time" }],
  [100, { type: "terminal", line: "~/moteur-rust $ cargo add tokio --features time", stream: "agent" }],
  [600, { type: "terminal", line: "      Adding tokio v1.47.1 to dependencies", stream: "stderr" }],
  [0, { type: "step_end", id: 5, summary: "OK · 0,6 s", ok: true }],
  [400, { type: "step_start", id: 6, label: "édition src/net/client.rs" }],
  [600, { type: "step_end", id: 6, summary: "+14 -2", ok: true }],
  [300, { type: "step_start", id: 7, label: "cargo build" }],
  [900, { type: "step_end", id: 7, summary: "OK · 3,2 s", ok: true }],
  [0, { type: "build", ok: true, errors: 0, seconds: 3.2 }],
  [200, { type: "step_start", id: 8, label: "cargo test" }],
  [900, { type: "step_end", id: 8, summary: "OK · 2,4 s", ok: true }],
  [0, { type: "tests", ok: true, failures: 0, seconds: 2.4 }],
  [200, { type: "text", text: "`ClientConfig` a maintenant un champ `timeout: Duration` (5 s par défaut), lu depuis `config.toml` et appliqué à la connexion via `tokio::time::timeout`. Le build passe." }],
  [0, { type: "done", ok: true, summary: "build et tests OK" }],
];

export function demoBackend(): Backend {
  let onPull: (p: PullProgress) => void = () => {};
  const installed = ["qwen2.5-coder:7b"];
  let onEvent: (tab: string, e: AgentEvent) => void = () => {};
  let onApproval: (tab: string, r: ApprovalRequest) => void = () => {};

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms * (window.location.hash === "#instant" ? 0 : 1)));
  const play = async (tab: string, steps: Step[]) => {
    for (const [delay, item] of steps) {
      await wait(delay);
      if ("approval" in item) onApproval(tab, item.approval);
      else if (item.type === "text") {
        // Comme un vrai modèle : le texte arrive par morceaux, puis le message complet.
        for (const word of item.text.match(/\S+\s*/g) ?? []) {
          onEvent(tab, { type: "delta", text: word });
          await wait(25);
        }
        onEvent(tab, item);
      } else onEvent(tab, item);
    }
  };

  return {
    demo: true,
    openProject: async (path) => projects[path] ?? projects["moteur-rust"],
    pickAndOpen: async () => projects["vision-py"],
    newProject: async (_parent, name, lang) => ({
      info: { ...projects["moteur-rust"], tab: name, name, lang: lang.toLowerCase(), lang_name: lang, lang_label: lang.slice(0, 3).toLowerCase(), files: ["NOTES.md"], build: null, test: null, feed: null },
      bootstrap: `Crée le squelette minimal d'un projet ${lang} nommé « ${name} »…`,
    }),
    pickFolder: async () => "~/projets",
    refresh: async (tab) => projects[tab],
    startTask: async (tab) => void play(tab, firstHalf),
    startFix: async (tab) => void play(tab, firstHalf.slice(0, -2)),
    cancel: async () => {},
    answer: async (tab, _id, decision) => {
      if (decision === "deny") void play(tab, [[200, { type: "text", text: "D'accord, je n'installe pas tokio. Je peux implémenter le timeout avec `std::net::TcpStream::set_read_timeout` à la place." }], [0, { type: "done", ok: true, summary: "en attente" }]]);
      else void play(tab, secondHalf);
    },
    undo: async () => ["src/config.rs"],
    terminal: async (tab, command) => {
      onEvent(tab, { type: "terminal", line: `~/${tab} $ ${command}`, stream: "agent" });
      onEvent(tab, { type: "terminal", line: "(démo : commande non exécutée)", stream: "stderr" });
      return true;
    },
    startupPaths: async () => [],
    saveFeed: async () => {},
    newConversation: async () => {},
    listConversations: async () => [
      { id: "1761130000-000", title: "Ajoute la lecture du fichier de config TOML", started: 1761130000, turns: 4 },
      { id: "1761040000-000", title: "Pourquoi le test parse_retries échoue ?", started: 1761040000, turns: 2 },
    ],
    restoreConversation: async () => [
      { kind: "user", text: "Ajoute la lecture du fichier de config TOML" },
      { kind: "text", text: "C'est fait : `Config::load` lit `config.toml` avec `toml::from_str`." },
      { kind: "notice", tone: "ok", text: "build OK" },
    ],
    getSettings: async () => ({ config, api_key: null, first_run: window.location.hash === "#premier", config_path: "~/.config/digital-arms/config.toml" }),
    saveSettings: async (c) => void Object.assign(config, c),
    detectSetup: async () => ({
      gpu: { name: "NVIDIA GeForce RTX 3080", vram_mb: 10240 },
      ollama_installed: true,
      probe: { reachable: true, ollama: true, models: [...installed], error: null },
      recommendation: {
        model: "qwen2.5-coder:14b",
        why: "10 Go de VRAM : un 14B (≈ 9 Go en Q4) tient en mémoire vidéo. Plus lent qu'un 7B, mais nettement meilleur pour corriger.",
        alternatives: ["qwen2.5-coder:7b", "qwen2.5-coder:14b"],
      },
    }),
    probeServer: async () => ({ reachable: true, ollama: true, models: [...installed], error: null }),
    pullModel: async (_url, model) => {
      const total = 9_000_000_000;
      for (let done = 0; done <= total; done += total / 20) {
        await new Promise((r) => setTimeout(r, 120));
        onPull({ status: `pulling ${model}`, completed: done, total });
      }
      installed.push(model);
      onPull({ status: "success", completed: total, total });
    },
    onPull: (cb) => void (onPull = cb),
    status: async () => ({ local_ok: true, local_detail: "qwen2.5-coder:14b", api_key: true }),
    onEvent: (cb) => void (onEvent = cb),
    onApproval: (cb) => void (onApproval = cb),
  };
}

export const DEMO_TABS = ["moteur-rust", "sim-cpp", "vision-py"];
export const DEMO_PROMPT = "Lance le build et corrige ce qui casse, puis ajoute un timeout configurable sur le client réseau.";
