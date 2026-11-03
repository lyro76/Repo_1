// Pont vers la coque Rust. Dans un navigateur (npm run dev), un backend de
// démonstration rejoue une génération pour travailler l'interface.

import type { EngineEvent, Run, Settings, Status } from "./types";

export interface Backend {
  readonly demo: boolean;
  status(): Promise<Status>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  setupEngine(): Promise<void>;
  startEngine(): Promise<void>;
  stopEngine(): Promise<void>;
  send(msg: Record<string, unknown>): Promise<void>;
  pickImage(): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  recordRun(run: Run): Promise<void>;
  listRuns(limit: number): Promise<Run[]>;
  startupPaths(): Promise<string[]>;
  revealPath(path: string): Promise<void>;
  /** URL lisible par la webview pour un fichier local. */
  fileUrl(path: string): string;
  onEngine(cb: (e: EngineEvent) => void): void;
  onEngineLog(cb: (line: string) => void): void;
  onSetup(cb: (line: string) => void): void;
  onDrop(cb: (paths: string[]) => void): void;
}

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriBackend(): Promise<Backend> {
  const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const opener = await import("@tauri-apps/plugin-opener");
  return {
    demo: false,
    status: () => invoke("status"),
    getSettings: () => invoke("get_settings"),
    saveSettings: (s) => invoke("save_settings", { new: s }),
    setupEngine: () => invoke("setup_engine"),
    startEngine: () => invoke("start_engine"),
    stopEngine: () => invoke("stop_engine"),
    send: (msg) => invoke("engine_send", { msg }),
    pickImage: () => invoke("pick_image"),
    pickFolder: () => invoke("pick_folder"),
    recordRun: (run) => invoke("record_run", { run }),
    listRuns: (limit) => invoke("list_runs", { limit }),
    startupPaths: () => invoke("startup_paths"),
    revealPath: (path) => opener.revealItemInDir(path),
    fileUrl: (path) => convertFileSrc(path),
    onEngine: (cb) => void listen<EngineEvent>("engine", (e) => cb(e.payload)),
    onEngineLog: (cb) => void listen<string>("engine_log", (e) => cb(e.payload)),
    onSetup: (cb) => void listen<string>("setup", (e) => cb(e.payload)),
    onDrop: (cb) => {
      void getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "drop") cb(e.payload.paths);
      });
    },
  };
}

export const backend: Promise<Backend> = inTauri ? tauriBackend() : import("./demo").then((m) => m.demoBackend());
