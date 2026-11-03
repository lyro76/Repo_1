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

export type Task = "i2v" | "t2v" | "t2i" | "i2i";

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
  kind: "video" | "image";
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
  kind: "video" | "image";
  task: Task;
  path: string;
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

export type EngineEvent =
  | { event: "ready"; version: string; machine: Machine }
  | { event: "probe"; id: number; machine: Machine; models: ModelInfo[] }
  | { event: "stage"; id: number; stage: Stage; label: string; status: "start" | "end"; seconds: number | null; ok?: boolean }
  | { event: "progress"; id: number; step: number; total: number; seconds_per_step: number }
  | { event: "log"; id?: number; text: string }
  | ({ event: "done"; id: number } & Done)
  | { event: "cancelled"; id: number }
  | { event: "loaded"; id?: number; model: ModelInfo }
  | { event: "unloaded"; id: number }
  | { event: "policy"; id?: number; auto_load: boolean }
  | { event: "error"; id?: number; message: string; trace?: string }
  | { event: "exited" };

export interface Settings {
  python: string | null;
  model_paths: string[];
  out_dir: string;
  ui: Record<string, unknown> | null;
}

export interface Status {
  engine_installed: boolean;
  engine_running: boolean;
  venv: string;
  pythons: { command: string; version: string }[];
  engine_src: string;
  runs_path: string;
}

/** Une ligne de l'historique (runs.jsonl). */
export interface Run {
  at: number;
  job: JobSpec;
  done: Done;
}
