// Miroir des types du moteur (engine/videoarms/protocol.py, models.py, system.py) et de la coque Rust.

export interface Machine {
  gpu: string | null;
  vram_mb: number;
  driver: string | null;
  ram_mb: number;
  ram_free_mb: number;
  torch: string | null;
  cuda: boolean;
  diffusers: string | null;
  sage: boolean;
  ffmpeg: boolean;
  notes: string[];
}

export type Task = "i2v" | "t2v" | "t2i" | "i2i" | "i23d" | "t23d" | "t2a" | "i2a";
export type Kind = "video" | "image" | "3d" | "audio";

export interface ModelInfo {
  id: string;
  name: string;
  path: string;
  backend: "ltx2" | "wan" | "sd" | "comfy" | "mock";
  family: string;
  format: string;
  size_gb: number;
  audio: boolean;
  distilled: boolean;
  supported: boolean;
  note: string;
  kind: Kind;
  tasks: Task[];
}

export interface JobSpec {
  model: string;
  task: Task;
  image: string;
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  seconds: number;
  fps: number;
  steps: number | null;
  guidance: number | null;
  seed: number | null;
  audio: boolean;
  strength: number;
  mode: "draft" | "final";
  memory: "auto" | "gpu" | "cpu_offload" | "group_offload";
  compile: boolean;
  sage: boolean;
  out_dir: string;
  name: string;
  post: { fps?: number; upscale?: number };
}

export type Stage = "load" | "encode" | "sample" | "decode" | "write" | "post";

export interface Timings {
  load: number; encode: number; sample: number; decode: number; write: number; post: number;
  seconds_per_step: number; total: number;
}

export interface Done {
  kind: Kind;
  task: Task;
  path: string;
  files?: string[];
  raw_path: string;
  frames: number;
  fps: number;
  width: number;
  height: number;
  audio: boolean;
  timings: Timings;
  vram_peak_mb: number;
  ram_peak_mb: number;
  memory: { strategy: string; label: string; reason: string; vae_tiling: boolean };
  settings: Record<string, unknown>;
  model: ModelInfo;
}

export interface ComfyStatus {
  dir: string | null;
  found: boolean;
  python: string | null;
  version: string | null;
  port: number;
  running: boolean;
  external: boolean;
  custom_nodes: string[];
}

export interface WorkflowAnalysis {
  kind: Kind;
  needs_image: boolean;
  tasks: Task[];
  nodes: number;
  params: Record<string, [string, string][]>;
  class_types: string[];
  warnings: string[];
}

export type EngineEvent =
  | { event: "ready"; version: string; machine: Machine }
  | { event: "probe"; id: number; machine: Machine; models: ModelInfo[]; comfy: ComfyStatus }
  | ({ event: "comfy"; id?: number } & ComfyStatus)
  | { event: "workflow"; id?: number; model: ModelInfo | null; analysis: WorkflowAnalysis; missing: string[] }
  | { event: "api"; id?: number; enabled: boolean; url?: string; port?: number; token?: boolean }
  | { event: "queued"; id: number; origin: string; task: Task; model: string; prompt: string }
  | { event: "stage"; id: number; stage: Stage; label: string; status: "start" | "end"; seconds: number | null; ok?: boolean }
  | { event: "progress"; id: number; step: number; total: number; seconds_per_step: number }
  | { event: "log"; id?: number; text: string }
  | ({ event: "done"; id: number } & Done)
  | { event: "cancelled"; id: number }
  | { event: "loaded"; id?: number; model: ModelInfo }
  | { event: "unloaded"; id: number }
  | { event: "policy"; id?: number; auto_load: boolean }
  | { event: "error"; id?: number; origin?: string; message: string; trace?: string }
  | { event: "exited" };

export interface Settings {
  python: string | null;
  model_paths: string[];
  out_dir: string;
  comfy_dir: string | null;
  comfy_python: string | null;
  comfy_port: number;
  ai_control: boolean;
  api_port: number;
  api_token: string | null;
  ui: Record<string, unknown> | null;
}

export interface Status {
  engine_installed: boolean;
  engine_running: boolean;
  venv: string;
  pythons: { command: string; version: string }[];
  engine_src: string;
  runs_path: string;
  workflows_dir: string;
  mcp_command: string;
}

/** Une ligne de l'historique (runs.jsonl). */
export interface Run {
  at: number;
  job: JobSpec;
  done: Done;
}
