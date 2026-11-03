// Backend factice pour développer l'interface dans un navigateur.

import type { Backend } from "./api";
import type { EngineEvent, ModelInfo, Run, Settings } from "./types";

const machine = { gpu: "NVIDIA GeForce RTX 3080", vram_mb: 10240, driver: "610.62", ram_mb: 65536, ram_free_mb: 48000, torch: "2.9.0+cu126", cuda: true, diffusers: "0.42.1", sage: true, ffmpeg: true, notes: [] };
const models: ModelInfo[] = [
  { id: "ltx2:/m/ltx23", name: "diffusers/LTX-2.3-Distilled-Diffusers", path: "/m/ltx23", backend: "ltx2", family: "LTX-2", format: "diffusers", size_gb: 27.4, audio: true, distilled: true, supported: true, note: "", kind: "video", tasks: ["i2v", "t2v"] },
  { id: "wan:/m/wan5b", name: "Wan-AI/Wan2.2-TI2V-5B-Diffusers", path: "/m/wan5b", backend: "wan", family: "Wan", format: "diffusers", size_gb: 21.3, audio: false, distilled: false, supported: true, note: "", kind: "video", tasks: ["i2v", "t2v"] },
  { id: "comfy:/m/ltx25", name: "LTX-2.5 (LTX-2.5-Distilled-Q4_K_S.gguf)", path: "/m/ltx25", backend: "comfy", family: "LTX-2", format: "comfy", size_gb: 14.1, audio: true, distilled: true, supported: false, note: "format GGUF/ComfyUI : pas encore pris en charge par ce moteur", kind: "video", tasks: [] },
  { id: "sd:/m/realvis", name: "SG161222/RealVisXL_V5.0", path: "/m/realvis", backend: "sd", family: "SDXL", format: "diffusers", size_gb: 6.9, audio: false, distilled: false, supported: true, note: "", kind: "image", tasks: ["t2i", "i2i"] },
  { id: "sd:/m/turbo", name: "SDXL_Turbo (SDXL)", path: "/m/turbo", backend: "sd", family: "SDXL", format: "single_file", size_gb: 6.9, audio: false, distilled: true, supported: true, note: "", kind: "image", tasks: ["t2i", "i2i"] },
  { id: "comfy:/w/hunyuan3d.json", name: "hunyuan3d_image_to_3d (ComfyUI)", path: "/w/hunyuan3d.json", backend: "comfy", family: "ComfyUI", format: "workflow", size_gb: 0, audio: false, distilled: false, supported: true, note: "", kind: "3d", tasks: ["i23d"] },
  { id: "comfy:/w/ace.json", name: "ace_step_musique (ComfyUI)", path: "/w/ace.json", backend: "comfy", family: "ComfyUI", format: "workflow", size_gb: 0, audio: true, distilled: false, supported: true, note: "", kind: "audio", tasks: ["t2a"] },
  { id: "mock", name: "Moteur factice (test, sans GPU)", path: "", backend: "mock", family: "test", format: "mock", size_gb: 0, audio: true, distilled: true, supported: true, note: "", kind: "video", tasks: ["i2v", "t2v", "t2i", "i2i", "i23d", "t23d", "t2a"] },
];
const settings: Settings = { python: "py -3.11", model_paths: ["C:\\Users\\Admin\\Documents\\SDXL_MODELS"], out_dir: "C:\\Users\\Admin\\Videos\\ScreenComfy", comfy_dir: "C:\\Users\\Admin\\Documents\\ComfyUI", comfy_python: null, comfy_port: 8188, ai_control: false, api_port: 8765, api_token: null, ui: null };
const comfy = { dir: settings.comfy_dir, found: true, python: "C:\\Users\\Admin\\Documents\\ComfyUI\\venv\\Scripts\\python.exe", version: "0.3.60", port: 8188, running: false, external: false, custom_nodes: ["comfyui-bench-samplers"] };
const runs: Run[] = [];

export function demoBackend(): Backend {
  let onEngine: (e: EngineEvent) => void = () => {};
  let onLog: (l: string) => void = () => {};
  let onSetup: (l: string) => void = () => {};
  let cancelled = false;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const generate = async (id: number, job: Record<string, any>) => {
    cancelled = false;
    const emit = (e: any) => onEngine({ ...e, id });
    const stage = async (stage: string, label: string, ms: number, detail?: any) => {
      emit({ event: "stage", stage, label, status: "start", seconds: null, ...detail });
      await wait(ms);
      emit({ event: "stage", stage, label, status: "end", seconds: ms / 1000, ok: true });
      return ms / 1000;
    };
    const t: any = {};
    onLog("stratégie mémoire : group_offload — modèle de 27.4 Go > VRAM : blocs streamés depuis la RAM (8 étapes)");
    t.load = await stage("load", "chargement du modèle", 1500);
    t.encode = await stage("encode", "encodage texte et image", 600);
    const steps = job.steps ?? 8;
    emit({ event: "stage", stage: "sample", label: "génération (sampling)", status: "start", seconds: null });
    for (let s = 1; s <= steps; s++) {
      if (cancelled) return emit({ event: "cancelled" });
      await wait(400);
      emit({ event: "progress", step: s, total: steps, seconds_per_step: 4.2 });
    }
    t.sample = steps * 4.2;
    emit({ event: "stage", stage: "sample", label: "génération (sampling)", status: "end", seconds: t.sample, ok: true });
    t.decode = await stage("decode", "décodage VAE", 900) * 9;
    t.write = await stage("write", "écriture de la vidéo", 300);
    t.post = job.post?.fps || job.post?.upscale ? await stage("post", "post-traitement", 700) : 0;
    const isImage = job.task === "t2i" || job.task === "i2i";
    const kind = job.task.endsWith("3d") ? "3d" : job.task.endsWith("2a") ? "audio" : isImage ? "image" : "video";
    emit({ event: "loaded", model: models.find((m) => m.id === job.model) ?? models[0] });
    emit({
      event: "done", kind, task: job.task, path: kind === "image" ? "/mark.png" : kind === "3d" ? "/demo/maillage.glb" : kind === "audio" ? "/demo/son.mp3" : "/demo/sortie.mp4", raw_path: "/demo/sortie.mp4", frames: isImage ? 1 : Math.round(job.seconds * job.fps), fps: job.fps,
      width: job.width, height: job.height, audio: job.audio,
      timings: { ...t, seconds_per_step: 4.2, total: Object.values(t).reduce((a: number, b: any) => a + b, 0) },
      vram_peak_mb: 9420, ram_peak_mb: 31200, memory: { strategy: "group_offload", label: "blocs streamés depuis la RAM pendant le calcul", reason: "modèle > VRAM", vae_tiling: true },
      settings: { steps, guidance: 1, seed: job.seed ?? 0, attention: "sage", compiled: false }, model: models.find((m) => m.id === job.model) ?? models[0],
    });
  };

  return {
    demo: true,
    status: async () => ({ engine_installed: true, engine_running: true, venv: "~/.local/share/screencomfy/engine-venv", pythons: [{ command: "py -3.11", version: "3.11.15" }], engine_src: "./engine", runs_path: "runs.jsonl", workflows_dir: "~/.local/share/screencomfy/workflows", mcp_command: "C:\\…\\engine-venv\\Scripts\\python.exe -m videoarms.mcp --url http://127.0.0.1:8765" }),
    pickJson: async () => "C:\\Users\\Admin\\Downloads\\ltx25_i2v_api.json",
    getSettings: async () => settings,
    saveSettings: async (s) => void Object.assign(settings, s),
    setupEngine: async () => {
      for (const l of ["› création de l'environnement", "› torch pour CUDA", "Collecting torch…", "› moteur et bibliothèques de modèles", "✓ moteur prêt"]) {
        await wait(400);
        onSetup(l);
      }
    },
    startEngine: async () => {
      await wait(200);
      onEngine({ event: "ready", version: "0.1.0", machine });
    },
    stopEngine: async () => {},
    send: async (msg) => {
      if (msg.cmd === "probe") {
        await wait(300);
        onEngine({ event: "probe", id: msg.id as number, machine, models, comfy });
      } else if (msg.cmd === "generate") void generate(msg.id as number, msg.job as any);
      else if (msg.cmd === "cancel") cancelled = true;
      else if (msg.cmd === "load") {
        await wait(800);
        onEngine({ event: "loaded", id: msg.id as number, model: models.find((m) => m.id === msg.model)! });
      } else if (msg.cmd === "unload") onEngine({ event: "unloaded", id: msg.id as number });
      else if (msg.cmd === "policy") onEngine({ event: "policy", auto_load: msg.auto_load as boolean });
      else if (msg.cmd === "api") onEngine({ event: "api", enabled: msg.enabled as boolean, url: `http://127.0.0.1:${msg.port}`, port: msg.port as number, token: !!msg.token });
      else if (msg.cmd === "comfy_start") {
        await wait(1500);
        comfy.running = true;
        onEngine({ event: "comfy", ...comfy });
      } else if (msg.cmd === "comfy_stop") {
        comfy.running = false;
        onEngine({ event: "comfy", ...comfy });
      } else if (msg.cmd === "workflow_import") {
        await wait(400);
        const m: ModelInfo = { id: "comfy:/w/ltx25.json", name: "ltx25_i2v_api (ComfyUI)", path: "/w/ltx25.json", backend: "comfy", family: "ComfyUI", format: "workflow", size_gb: 0, audio: true, distilled: true, supported: true, note: "", kind: "video", tasks: ["i2v"] };
        models.unshift(m);
        onEngine({ event: "workflow", model: m, analysis: { kind: "video", needs_image: true, tasks: ["i2v"], nodes: 14, params: { image: [["1", "image"]], prompt: [["3", "text"]], seed: [["6", "noise_seed"]] }, class_types: ["UnetLoaderGGUF", "LoadImage"], warnings: [] }, missing: ["UnetLoaderGGUF"] });
      }
    },
    pickImage: async () => "/mark.png",
    pickFolder: async () => "C:\\Users\\Admin\\Documents\\Modeles",
    recordRun: async (r) => void runs.unshift(r),
    listRuns: async (n) => runs.slice(0, n),
    startupPaths: async () => [],
    revealPath: async () => {},
    fileUrl: (p) => (p === "/demo/sortie.mp4" ? "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" : p),
    onEngine: (cb) => void (onEngine = cb),
    onEngineLog: (cb) => void (onLog = cb),
    onSetup: (cb) => void (onSetup = cb),
    onDrop: () => {},
  };
}
