// Miroir des types sérialisés par da-core (events.rs, diag/mod.rs, config.rs).

export type Mode = "local" | "api" | "auto";

export interface Suggestion {
  message: string;
  file: string;
  line_start: number;
  replacement: string;
  machine_applicable: boolean;
}

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  level: "error" | "warning" | "note";
  code: string | null;
  message: string;
  notes: string[];
  suggestions: Suggestion[];
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "delta"; text: string }
  | { type: "step_start"; id: number; label: string }
  | { type: "step_end"; id: number; summary: string; ok: boolean }
  | { type: "terminal"; line: string; stream: "stdout" | "stderr" | "agent" }
  | { type: "diagnostics"; items: Diagnostic[] }
  | { type: "patch"; snapshot: string; file: string; diff: string; attempt: number; backend: string }
  | { type: "build"; ok: boolean; errors: number; seconds: number }
  | { type: "tests"; ok: boolean; failures: number; seconds: number }
  | { type: "escalated"; reason: string }
  | { type: "done"; ok: boolean; summary: string }
  | { type: "usage"; backend: string; calls: number };

export interface ApprovalRequest {
  id: number;
  title: string;
  detail: string;
  rule: string;
}

export type Decision = "allow" | "deny" | "always_allow";

export interface Config {
  mode: Mode;
  local: { base_url: string; model: string; text_tools: boolean; context_tokens: number; api_key?: string | null };
  api: { model: string; effort: string; base_url: string };
  max_attempts: number;
  max_steps: number;
  auto_fix: boolean;
  fix_tests: boolean;
  confirm_writes: boolean;
  build_cmd: string | null;
  test_cmd: string | null;
}

export interface ProjectInfo {
  tab: string;
  name: string;
  root: string;
  /** Langage détecté : identifiant, nom lisible, étiquette d'onglet. Aucune liste fermée. */
  lang: string;
  lang_name: string;
  lang_label: string;
  files: string[];
  notes: string;
  config: Config;
  build: string | null;
  test: string | null;
  /** Fil de la conversation en cours, tel qu'enregistré par l'interface (null si aucun). */
  feed: unknown;
}

export interface ConversationInfo {
  id: string;
  title: string;
  started: number;
  turns: number;
}

export interface NewProject {
  info: ProjectInfo;
  /** Demande à lancer : l'agent écrit le squelette (langages sans modèle intégré). */
  bootstrap: string | null;
}

export interface Status {
  local_ok: boolean;
  local_detail: string;
  api_key: boolean;
}

export interface Options {
  mode: Mode;
  auto_fix: boolean;
  confirm_writes: boolean;
}

export interface Settings {
  config: Config;
  /** Origine de la clé API : variable d'environnement, réglages, ou absente. */
  api_key: "env" | "settings" | null;
  first_run: boolean;
  config_path: string;
}

export interface Probe {
  reachable: boolean;
  ollama: boolean;
  models: string[];
  error: string | null;
}

export interface Setup {
  gpu: { name: string; vram_mb: number } | null;
  ollama_installed: boolean;
  probe: Probe;
  recommendation: { model: string; why: string; alternatives: string[] };
}

export interface PullProgress {
  status: string;
  completed: number;
  total: number;
}
