// Miroir des types sérialisés par da-core (events.rs, diag/mod.rs, config.rs).

export type Mode = "local" | "api" | "auto";
export type Lang = "rust" | "cpp" | "python" | "unknown";

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
  | { type: "step_start"; id: number; label: string }
  | { type: "step_end"; id: number; summary: string; ok: boolean }
  | { type: "terminal"; line: string; stream: "stdout" | "stderr" | "agent" }
  | { type: "diagnostics"; items: Diagnostic[] }
  | { type: "patch"; snapshot: string; file: string; diff: string; attempt: number; backend: string }
  | { type: "build"; ok: boolean; errors: number; seconds: number }
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
  confirm_writes: boolean;
  build_cmd: string | null;
  test_cmd: string | null;
}

export interface ProjectInfo {
  tab: string;
  name: string;
  root: string;
  lang: Lang;
  files: string[];
  notes: string;
  config: Config;
  build: string | null;
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
