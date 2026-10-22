// Pont vers le backend Rust. Hors de Tauri (navigateur, `npm run dev`), un
// backend de démonstration rejoue un scénario pour travailler l'interface.

import type { AgentEvent, ApprovalRequest, Decision, NewProject, Options, ProjectInfo, Status } from "./types";
import { demoBackend } from "./demo";

export interface Backend {
  readonly demo: boolean;
  openProject(path: string): Promise<ProjectInfo>;
  pickAndOpen(): Promise<ProjectInfo | null>;
  newProject(parent: string, name: string, lang: string): Promise<NewProject>;
  pickFolder(): Promise<string | null>;
  refresh(tab: string): Promise<ProjectInfo>;
  startTask(tab: string, prompt: string, options: Options): Promise<void>;
  startFix(tab: string, options: Options): Promise<void>;
  cancel(tab: string): Promise<void>;
  answer(tab: string, id: number, decision: Decision): Promise<void>;
  undo(tab: string, snapshot: string): Promise<string[]>;
  terminal(tab: string, command: string): Promise<boolean>;
  status(tab: string | null): Promise<Status>;
  startupPaths(): Promise<string[]>;
  onEvent(cb: (tab: string, e: AgentEvent) => void): void;
  onApproval(cb: (tab: string, r: ApprovalRequest) => void): void;
}

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const dialog = await import("@tauri-apps/plugin-dialog");
  const pickFolder = async () => {
    const r = await dialog.open({ directory: true, multiple: false });
    return typeof r === "string" ? r : null;
  };
  return {
    demo: false,
    openProject: (path) => invoke("open_project", { path }),
    pickAndOpen: async () => {
      const p = await pickFolder();
      return p ? invoke("open_project", { path: p }) : null;
    },
    newProject: (parent, name, lang) => invoke("new_project", { parent, name, lang }),
    pickFolder,
    refresh: (tab) => invoke("refresh", { tab }),
    startTask: (tab, prompt, options) => invoke("start_task", { tab, prompt, options }),
    startFix: (tab, options) => invoke("start_fix", { tab, options }),
    cancel: (tab) => invoke("cancel", { tab }),
    answer: (tab, id, decision) => invoke("answer", { tab, id, decision }),
    undo: (tab, snapshot) => invoke("undo", { tab, snapshot }),
    terminal: (tab, command) => invoke("terminal", { tab, command }),
    status: (tab) => invoke("status", { tab }),
    startupPaths: () => invoke("startup_paths"),
    onEvent: (cb) => {
      listen<AgentEvent & { tab: string }>("agent", ({ payload }) => {
        const { tab, ...e } = payload;
        cb(tab, e as AgentEvent);
      });
    },
    onApproval: (cb) => {
      listen<ApprovalRequest & { tab: string }>("approval", ({ payload }) => {
        const { tab, ...r } = payload;
        cb(tab, r);
      });
    },
  };
}

export const backend: Promise<Backend> = inTauri ? tauriBackend() : Promise.resolve(demoBackend());
