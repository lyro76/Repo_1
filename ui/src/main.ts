import { backend, type Backend } from "./api";
import { $, h } from "./dom";
import type { ComfyStatus, Done, EngineEvent, JobSpec, Kind, Machine, ModelInfo, Run, Settings, Stage, Status, Task } from "./types";

// ---------- état ----------

interface QueueItem {
  id: number;
  /** « ia » ou « api » : lancé de l'extérieur, affiché mais pas piloté d'ici. */
  origin?: string;
  job: JobSpec;
  state: "waiting" | "running" | "done" | "error" | "cancelled";
  stages: Partial<Record<Stage, { label: string; seconds: number | null; running: boolean; ok: boolean }>>;
  progress?: { step: number; total: number; sps: number };
  done?: Done;
  error?: string;
}

const STAGES: Stage[] = ["load", "encode", "sample", "decode", "write", "post"];
const STAGE_SHORT: Record<Stage, string> = { load: "chargement", encode: "encodage", sample: "sampling", decode: "VAE", write: "écriture", post: "post" };

const state = {
  settings: null as Settings | null,
  status: null as Status | null,
  machine: null as Machine | null,
  models: [] as ModelInfo[],
  engine: "off" as "off" | "starting" | "ready" | "busy" | "error",
  image: null as string | null,
  mode: "draft" as "draft" | "final",
  kind: "video" as Kind,
  source: "image" as "image" | "prompt",
  loaded: null as ModelInfo | null,
  autoLoad: true,
  comfy: null as ComfyStatus | null,
  /** Nœuds manquants par workflow (id de modèle → classes). */
  missing: {} as Record<string, string[]>,
  api: null as { enabled: boolean; url?: string } | null,
  queue: [] as QueueItem[],
  nextId: 1,
  runs: [] as Run[],
  log: [] as string[],
  lastDone: null as QueueItem | null,
};

let api: Backend;
const cur = () => state.queue.find((q) => q.state === "running") ?? null;
const KIND_SUFFIX: Record<Kind, string> = { video: "v", image: "i", "3d": "3d", audio: "a" };
const task = (): Task => `${state.source === "image" ? "i" : "t"}2${KIND_SUFFIX[state.kind]}` as Task;
const TASK_LABEL: Record<Task, string> = { i2v: "image → vidéo", t2v: "prompt → vidéo", t2i: "prompt → image", i2i: "image → image", i23d: "image → 3D", t23d: "prompt → 3D", t2a: "prompt → audio", i2a: "image → audio" };
const kindOfTask = (t: Task): Kind => (t.endsWith("3d") ? "3d" : t.endsWith("2a") ? "audio" : t.endsWith("v") ? "video" : "image");
const isTimed = (t: Task) => t.endsWith("v") || t.endsWith("2a");

const RES_VIDEO = [["1280x720", "720p"], ["1920x1080", "1080p"], ["854x480", "480p"], ["custom", "Autre…"]];
const RES_IMAGE = [["1024x1024", "1024 carré"], ["1152x896", "1152×896"], ["1344x768", "1344×768 (16:9)"], ["768x768", "768 (SD 1.5)"], ["custom", "Autre…"]];

// ---------- rendu ----------

const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(1).replace(".", ",")} s`);
const gb = (mb: number) => `${(mb / 1024).toFixed(1).replace(".", ",")} Go`;

function renderEngineBadge() {
  const b = $("engine-badge");
  const text = { off: "Moteur arrêté", starting: "Démarrage…", ready: "Moteur prêt", busy: "Génération en cours", error: "Moteur en erreur" }[state.engine];
  b.className = `badge ${state.engine}`;
  b.textContent = text;
}

function renderModels() {
  const sel = $<HTMLSelectElement>("model");
  const prev = sel.value;
  const t = task();
  const shown = state.models.filter((m) => m.tasks.includes(t) || (!m.supported && m.kind === state.kind));
  sel.replaceChildren(
    ...shown.map((m) =>
      h("option", { value: m.id, disabled: !m.supported || undefined }, `${m.name}${m.size_gb ? ` · ${m.size_gb} Go` : ""}${m.supported ? "" : " (bientôt)"}`),
    ),
  );
  const usable = shown.filter((m) => m.supported);
  const remembered = (state.settings?.ui?.[`model_${state.kind}`] as string) || "";
  const wanted = usable.some((m) => m.id === prev) ? prev : remembered;
  sel.value = usable.some((m) => m.id === wanted) ? wanted : (usable.find((m) => m.backend !== "mock")?.id ?? usable[0]?.id ?? "");
  renderModelNote();
}

function renderLoaded() {
  $("loaded-name").textContent = state.loaded ? `chargé : ${state.loaded.name}` : "aucun modèle chargé";
  $("loaded-name").className = state.loaded ? "small" : "muted small";
  const busy = state.engine !== "ready";
  $("load-btn").toggleAttribute("disabled", busy || !selectedModel() || state.loaded?.id === selectedModel()?.id);
  $("unload-btn").toggleAttribute("disabled", busy || !state.loaded);
  $("opt-autoload").setAttribute("aria-pressed", String(state.autoLoad));
}

function selectedModel(): ModelInfo | undefined {
  return state.models.find((m) => m.id === $<HTMLSelectElement>("model").value);
}

function renderModelNote() {
  const m = selectedModel();
  const parts: string[] = [];
  if (m?.note) parts.push(m.note);
  if (m && state.kind === "video" && !m.audio) parts.push("ce modèle ne produit pas d'audio");
  if (m?.distilled) parts.push("distillé : peu d'étapes, rapide");
  $("model-note").textContent = parts.join(" · ");
  const cn = $("comfy-note");
  if (m?.backend === "comfy") {
    const miss = state.missing[m.id];
    cn.hidden = false;
    cn.replaceChildren(
      h("span", {}, `exécuté par ComfyUI${state.comfy?.running ? " (en marche)" : " (sera démarré en arrière-plan)"}`),
      miss?.length ? h("span", { class: "missing" }, ` · nœuds manquants : ${miss.join(", ")}`) : miss ? h("span", { class: "ok" }, " · nœuds OK") : "",
    );
  } else cn.hidden = true;
  $("opt-audio").toggleAttribute("disabled", !!m && !m.audio);
  $("opt-audio").hidden = state.kind !== "video";
  renderLoaded();
  renderEstimate();
}

function renderStages() {
  const q = cur() ?? state.lastDone;
  const box = $("stages");
  $("job-title").textContent = q ? `${q.origin ? `${q.origin.toUpperCase()} ` : ""}#${q.id} · ${TASK_LABEL[q.job.task]}${q.job.width ? ` · ${q.job.width}×${q.job.height}` : ""}${isTimed(q.job.task) ? ` · ${q.job.seconds} s` : ""} · ${q.job.mode === "draft" ? "brouillon" : "final"}` : "";
  $("cancel").hidden = !cur();
  if (!q) {
    box.replaceChildren(h("div", { class: "muted small empty" }, "Choisis une image, décris le mouvement, puis Générer."));
    $("progress").hidden = true;
    return;
  }
  box.replaceChildren(
    ...STAGES.map((s) => {
      const st = q.stages[s];
      const cls = !st ? "todo" : st.running ? "run" : st.ok ? "ok" : "err";
      return h("div", { class: `stage ${cls}` }, h("span", { class: "dot" }), h("span", { class: "name" }, STAGE_SHORT[s]), h("span", { class: "mono time" }, st?.seconds != null ? fmt(st.seconds) : st?.running ? "…" : ""));
    }),
  );
  const p = q.progress;
  const running = q.state === "running";
  $("progress").hidden = !(running && p);
  if (p) {
    ($("progress").querySelector(".bar i") as HTMLElement).style.width = `${Math.round((p.step / p.total) * 100)}%`;
    const eta = (p.total - p.step) * p.sps;
    $("progress-text").textContent = `pas ${p.step}/${p.total} · ${p.sps.toFixed(2).replace(".", ",")} s/pas${running ? ` · reste ≈ ${fmt(eta)}` : ""}`;
  }
}

function renderQueue() {
  const items = state.queue.filter((q) => q.state !== "done" || q === state.lastDone);
  $("queue").replaceChildren(
    ...items.map((q) => {
      const label = { waiting: "en attente", running: "en cours", done: "terminé", error: "échec", cancelled: "annulé" }[q.state];
      const row = h("div", { class: `qitem ${q.state}${q.origin ? " external" : ""}` }, h("span", { class: "mono" }, q.origin ? q.origin.toUpperCase() : `#${q.id}`), h("span", { class: "qp" }, q.job.prompt || "(sans prompt)"), h("span", { class: "muted small" }, `${TASK_LABEL[q.job.task]}${q.job.width ? ` · ${q.job.width}×${q.job.height}` : ""}${isTimed(q.job.task) ? ` · ${q.job.seconds} s` : ""}`), h("span", { class: `qs ${q.state}` }, label));
      if (q.state === "error") row.append(h("div", { class: "err small" }, q.error ?? ""));
      if (q.state === "waiting" && !q.origin) {
        const b = h("button", { class: "link small" }, "retirer");
        b.onclick = () => {
          state.queue = state.queue.filter((x) => x !== q);
          renderQueue();
        };
        row.append(b);
      }
      return row;
    }),
  );
}

function renderLog() {
  const box = $("log");
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  box.replaceChildren(...state.log.slice(-300).map((l) => h("div", {}, l)));
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function renderResult() {
  const q = state.lastDone;
  const player = $("player");
  $("reveal").hidden = !q;
  $("to-final").hidden = !q || q.job.mode !== "draft" || !!q.origin || !(q.job.task.endsWith("v") || q.job.task.endsWith("i"));
  if (!q?.done) {
    player.replaceChildren(h("div", { class: "muted small" }, "La vidéo s'affichera ici."));
    $("result-info").replaceChildren();
    return;
  }
  const d = q.done;
  const url = `${api.fileUrl(d.path)}?t=${Date.now()}`;
  const name = d.path.split(/[\\/]/).pop() ?? d.path;
  player.replaceChildren(
    d.kind === "image" ? h("img", { src: url, alt: "" })
      : d.kind === "audio" ? h("audio", { controls: true, src: url })
      : d.kind === "3d" ? h("div", { class: "mesh" }, h("b", {}, name), h("span", {}, "modèle 3D produit — ouvre le dossier pour le voir (Windows : Visionneuse 3D)"))
      : h("video", { controls: true, src: url, preload: "metadata" }),
  );
  const t = d.timings;
  const rows: [string, string][] = [
    ["Fichier", d.path.split(/[\\/]/).pop() ?? d.path],
    [{ image: "Image", video: "Vidéo", "3d": "3D", audio: "Audio" }[d.kind], d.kind === "image" ? `${d.width}×${d.height}` : d.kind === "video" ? `${d.width}×${d.height} · ${d.frames} images · ${d.fps} i/s${d.audio ? " · audio" : ""}` : `${(d.files ?? [d.path]).length} fichier(s)`],
    ["Temps total", fmt(t.total)],
    ["Sampling", `${fmt(t.sample)} (${t.seconds_per_step.toFixed(2).replace(".", ",")} s/pas × ${d.settings.steps ?? "?"})`],
    ["VAE", fmt(t.decode)],
    ["Mémoire", `${d.memory?.label ?? d.memory?.strategy ?? "—"} · pic VRAM ${gb(d.vram_peak_mb)}${d.ram_peak_mb ? ` · RAM ${gb(d.ram_peak_mb)}` : ""}`],
    ["Réglages", `graine ${d.settings.seed} · guidage ${d.settings.guidance}${d.settings.strength != null ? ` · liberté ${d.settings.strength}` : ""}${d.settings.attention ? ` · attention ${d.settings.attention}` : ""}${d.settings.compiled ? " · compilé" : ""}`],
  ];
  $("result-info").replaceChildren(...rows.map(([k, v]) => h("div", { class: "irow" }, h("span", { class: "k" }, k), h("span", {}, v))));
}

function renderHistory() {
  const box = $("history");
  if (!state.runs.length) {
    box.replaceChildren(h("div", { class: "muted small" }, "Aucune génération encore."));
    return;
  }
  const max = Math.max(...state.runs.map((r) => r.done.timings.total), 1);
  box.replaceChildren(
    ...state.runs.slice(0, 12).map((r) => {
      const t = r.done.timings;
      const seg = (s: Stage, cls: string) => h("i", { class: cls, style: `width:${((t[s] || 0) / max) * 100}%`, title: `${STAGE_SHORT[s]} ${fmt(t[s] || 0)}` });
      const row = h(
        "div",
        { class: "hrow" },
        h("div", { class: "htop" }, h("span", { class: "hname" }, `${r.done.model.family} · ${TASK_LABEL[r.job.task]}${r.job.width ? ` · ${r.job.width}×${r.job.height}` : ""}${isTimed(r.job.task) ? ` · ${r.job.seconds} s` : ""}`), h("span", { class: "mono small" }, fmt(t.total)), h("span", { class: "muted small" }, `VRAM ${gb(r.done.vram_peak_mb)}`)),
        h("div", { class: "hbar" }, seg("load", "s-load"), seg("encode", "s-encode"), seg("sample", "s-sample"), seg("decode", "s-decode"), seg("write", "s-write"), seg("post", "s-post")),
        h("div", { class: "muted small" }, `${r.done.memory?.strategy ?? ""}${r.done.settings.attention ? ` · ${r.done.settings.attention}` : ""}${r.done.settings.compiled ? " · compilé" : ""} · ${new Date(r.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`),
      );
      row.title = r.job.prompt;
      row.onclick = () => applyJob(r.job);
      return row;
    }),
  );
}

function renderStatus() {
  const m = state.machine;
  const parts: (Node | string)[] = [];
  parts.push(h("span", {}, m?.gpu ? `${m.gpu} · ${gb(m.vram_mb)} VRAM` : "GPU : inconnu"));
  if (m) parts.push(h("span", {}, `RAM libre ${gb(m.ram_free_mb)}`));
  parts.push(h("span", {}, m?.torch ? `torch ${m.torch}${m.cuda ? " · CUDA" : " · CPU"}` : "torch absent"));
  if (m?.sage) parts.push(h("span", { class: "ok" }, "SageAttention"));
  parts.push(h("span", {}, `${state.models.filter((x) => x.supported && x.backend !== "mock" && x.backend !== "comfy").length} modèle(s) · ${state.models.filter((x) => x.backend === "comfy" && x.supported).length} workflow(s)`));
  if (state.comfy?.found) parts.push(h("span", { class: state.comfy.running ? "ok" : "" }, `ComfyUI ${state.comfy.running ? (state.comfy.external ? "externe" : "en marche") : "arrêté"}`));
  if (state.api?.enabled) parts.push(h("span", { class: "ok" }, `API ${state.api.url ?? ""}`));
  parts.push(h("div", { class: "spacer" }));
  for (const n of m?.notes ?? []) parts.push(h("span", { class: "warn" }, n));
  $("status").replaceChildren(...parts);
}

function renderEstimate() {
  const { width, height, seconds } = readDims();
  const m = selectedModel();
  const el = $("estimate");
  if (!m || state.kind === "3d" || state.kind === "audio") return void (el.textContent = "");
  // Estimation à partir de l'historique : s/pas du même modèle, mis à l'échelle en pixels × images.
  const same = state.runs.filter((r) => r.done.model.id === m.id && r.done.timings.seconds_per_step > 0 && kindOfTask(r.job.task) === state.kind);
  if (!same.length) return void (el.textContent = m.backend === "mock" ? "" : "pas encore d'historique pour estimer le temps");
  const ref = same[0];
  const secs = (j: { seconds: number; task: Task }) => (j.task.endsWith("v") ? j.seconds : 1);
  const scale = (width * height * secs({ seconds, task: task() })) / (ref.job.width * ref.job.height * secs(ref.job));
  const steps = Number($<HTMLInputElement>("steps").value) || (ref.done.settings.steps as number) || 8;
  const est = ref.done.timings.seconds_per_step * scale * steps + ref.done.timings.decode * scale + ref.done.timings.load * 0.3;
  el.textContent = `≈ ${fmt(est)} d'après l'historique`;
}

function render() {
  renderEngineBadge();
  renderLoaded();
  renderStages();
  renderQueue();
  renderResult();
  renderHistory();
  renderStatus();
  renderEstimate();
}

// ---------- formulaire ----------

function readDims() {
  let width: number, height: number;
  const res = $<HTMLSelectElement>("res").value;
  if (res === "custom") {
    width = Number($<HTMLInputElement>("width").value) || 1280;
    height = Number($<HTMLInputElement>("height").value) || 720;
  } else {
    const [w, hh] = res.split("x").map(Number);
    const o = $<HTMLSelectElement>("orient").value;
    [width, height] = o === "p" ? [hh, w] : o === "s" ? [hh, hh] : [w, hh];
  }
  if (state.mode === "draft" && res !== "custom") {
    // Brouillon : moitié de la cible, arrondie à 32 (vidéo) ou 64 (image).
    const step = state.kind === "video" ? 32 : 64;
    width = Math.max(256, Math.round(width / 2 / step) * step);
    height = Math.max(256, Math.round(height / 2 / step) * step);
  }
  const seconds = Math.min(state.kind === "audio" ? 600 : 20, Math.max(1, Number($<HTMLInputElement>("seconds").value) || 5));
  const fps = Number($<HTMLInputElement>("fps").value) || 24;
  return { width, height, seconds, fps };
}

function pressed(id: string) {
  return $(id).getAttribute("aria-pressed") === "true";
}

function buildJob(): JobSpec | string {
  const t = task();
  if (state.source === "image" && !state.image) return "choisis une image de départ";
  const m = selectedModel();
  if (!m) return `aucun modèle pour « ${TASK_LABEL[t]} » : ajoute un dossier de modèles dans les réglages`;
  if (!$<HTMLTextAreaElement>("prompt").value.trim() && state.source === "prompt") return "écris un prompt";
  let { width, height, seconds, fps } = readDims();
  if (state.kind === "3d" || state.kind === "audio") {
    width = height = 0;
  }
  const num = (id: string) => {
    const v = $<HTMLInputElement>(id).value.trim();
    return v === "" ? null : Number(v);
  };
  const post: JobSpec["post"] = {};
  const pf = num("post-fps");
  const pu = num("post-up");
  if (pf) post.fps = pf;
  if (pu && pu !== 1) post.upscale = pu;
  const seedLocked = pressed("opt-seedlock");
  const seed = seedLocked ? Number($<HTMLInputElement>("seed").value) || 0 : Math.floor(Math.random() * 2 ** 31);
  if (!seedLocked) $<HTMLInputElement>("seed").value = String(seed);
  return {
    model: m.id,
    task: t,
    image: state.source === "image" ? state.image! : "",
    prompt: $<HTMLTextAreaElement>("prompt").value.trim(),
    negative_prompt: $<HTMLTextAreaElement>("negative").value.trim(),
    width, height, seconds, fps,
    steps: num("steps"), guidance: num("guidance"), seed,
    audio: state.kind === "audio" || (pressed("opt-audio") && m.audio),
    strength: Number($<HTMLInputElement>("strength").value) || 0.6,
    mode: state.mode,
    memory: $<HTMLSelectElement>("memory").value as JobSpec["memory"],
    compile: pressed("opt-compile"), sage: pressed("opt-sage"),
    out_dir: state.settings?.out_dir ?? "sorties",
    name: "",
    post,
  };
}

function blankJob(t: Task): JobSpec {
  return { model: "", task: t, image: "", prompt: "", negative_prompt: "", width: 0, height: 0, seconds: 5, fps: 24, steps: null, guidance: null, seed: null, audio: false, strength: 0.6, mode: "final", memory: "auto", compile: false, sage: false, out_dir: "", name: "", post: {} };
}

/** Remplit le formulaire depuis un job (historique, ou « rendu final »). */
function applyJob(job: JobSpec) {
  setKind(kindOfTask(job.task), false);
  setSource(job.task.startsWith("i") ? "image" : "prompt");
  if (job.image) {
    state.image = job.image;
    showImage(job.image);
  }
  $<HTMLInputElement>("strength").value = String(job.strength ?? 0.6);
  $("strength-val").textContent = String(job.strength ?? 0.6).replace(".", ",");
  $<HTMLTextAreaElement>("prompt").value = job.prompt;
  $<HTMLTextAreaElement>("negative").value = job.negative_prompt;
  $<HTMLSelectElement>("model").value = job.model;
  $<HTMLSelectElement>("res").value = "custom";
  $("custom-res").hidden = false;
  $<HTMLInputElement>("width").value = String(job.width);
  $<HTMLInputElement>("height").value = String(job.height);
  $<HTMLInputElement>("fps").value = String(job.fps);
  $<HTMLInputElement>("seconds").value = String(job.seconds);
  $<HTMLInputElement>("steps").value = job.steps == null ? "" : String(job.steps);
  $<HTMLInputElement>("guidance").value = job.guidance == null ? "" : String(job.guidance);
  $<HTMLInputElement>("seed").value = String(job.seed ?? 0);
  $("opt-seedlock").setAttribute("aria-pressed", "true");
  $("opt-audio").setAttribute("aria-pressed", String(job.audio));
  $("opt-sage").setAttribute("aria-pressed", String(job.sage));
  $("opt-compile").setAttribute("aria-pressed", String(job.compile));
  $<HTMLSelectElement>("memory").value = job.memory;
  $<HTMLInputElement>("post-fps").value = job.post.fps ? String(job.post.fps) : "";
  $<HTMLInputElement>("post-up").value = job.post.upscale ? String(job.post.upscale) : "";
  renderModelNote();
}

function showImage(path: string | null) {
  const img = $<HTMLImageElement>("drop-img");
  img.hidden = !path;
  $("drop-hint").hidden = !!path;
  if (path) img.src = api.fileUrl(path);
}

function setMode(mode: "draft" | "final") {
  state.mode = mode;
  document.querySelectorAll<HTMLButtonElement>("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  $("mode-hint").textContent = mode === "draft" ? "demi-résolution, pour itérer vite sur le prompt et le cadrage" : "résolution demandée, même graine : le rendu définitif";
  renderEstimate();
}

function setKind(kind: Kind, refresh = true) {
  state.kind = kind;
  document.querySelectorAll<HTMLButtonElement>("#kind button").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
  const res = $<HTMLSelectElement>("res");
  const prev = res.value;
  const list = kind === "image" ? RES_IMAGE : RES_VIDEO;
  res.replaceChildren(...list.map(([v, l]) => h("option", { value: v }, l)));
  res.value = list.some(([v]) => v === prev) ? prev : list[0][0];
  const sized = kind === "video" || kind === "image";
  $("custom-res").hidden = !sized || res.value !== "custom";
  $("res").closest("label")!.hidden = !sized;
  $("orient").closest("label")!.hidden = !sized;
  $("seconds-field").hidden = !(kind === "video" || kind === "audio");
  $("count-field").hidden = kind !== "image";
  $("post-fps").closest("label")!.hidden = kind !== "video";
  $("post-up").closest("label")!.hidden = !sized;
  $("mode").hidden = !sized;
  $("mode-hint").hidden = !sized;
  if (kind === "audio") $<HTMLInputElement>("seconds").max = "600";
  else $<HTMLInputElement>("seconds").max = "20";
  setSource(state.source);
  if (refresh) renderModels();
}

function setSource(source: "image" | "prompt") {
  state.source = source;
  document.querySelectorAll<HTMLButtonElement>("#source button").forEach((b) => b.classList.toggle("on", b.dataset.source === source));
  $("drop").hidden = source === "prompt";
  $("strength-field").hidden = !(state.kind === "image" && source === "image");
  $("opt-audio").hidden = state.kind !== "video";
  $("model-note").textContent = "";
  renderModels();
}

// ---------- moteur ----------

async function ensureEngine(): Promise<boolean> {
  if (state.engine === "ready" || state.engine === "busy") return true;
  const st = await api.status();
  state.status = st;
  if (!st.engine_installed) {
    pushLog("moteur non installé : ouvre les réglages (⚙) et clique sur « Installer le moteur »");
    return false;
  }
  state.engine = "starting";
  renderEngineBadge();
  try {
    await api.startEngine();
  } catch (e) {
    state.engine = "error";
    pushLog(String(e));
    renderEngineBadge();
    return false;
  }
  return true;
}

async function probe() {
  const s = state.settings!;
  await api.send({
    id: 0, cmd: "probe", paths: s.model_paths ?? [],
    comfy: { dir: s.comfy_dir || null, python: s.comfy_python || null, port: s.comfy_port || 8188 },
    workflows_dir: state.status?.workflows_dir ?? null,
  });
}

async function applyAiControl() {
  const s = state.settings!;
  await api.send({ id: -3, cmd: "api", enabled: !!s.ai_control, port: s.api_port || 8765, token: s.api_token || null, out_dir: s.out_dir });
}

function pushLog(line: string) {
  state.log.push(line);
  if (state.log.length > 2000) state.log.splice(0, state.log.length - 2000);
  renderLog();
}

async function pump() {
  if (cur() || state.engine !== "ready") return;
  const next = state.queue.find((q) => q.state === "waiting");
  if (!next) return;
  next.state = "running";
  next.stages = {};
  state.engine = "busy";
  render();
  try {
    await api.send({ id: next.id, cmd: "generate", job: next.job });
  } catch (e) {
    next.state = "error";
    next.error = String(e);
    state.engine = "ready";
    render();
    void pump();
  }
}

function onEngine(e: EngineEvent) {
  switch (e.event) {
    case "ready":
      state.machine = e.machine;
      state.engine = "ready";
      renderEngineBadge();
      renderStatus();
      void probe();
      return;
    case "probe":
      state.machine = e.machine;
      state.models = e.models;
      state.comfy = e.comfy;
      renderModels();
      renderStatus();
      void api.send({ id: -2, cmd: "policy", auto_load: state.autoLoad });
      void applyAiControl();
      void pump();
      return;
    case "comfy":
      state.comfy = e;
      renderStatus();
      renderModelNote();
      renderSettingsComfy();
      return;
    case "workflow":
      if (e.model) {
        if (!state.models.some((m) => m.id === e.model!.id)) state.models.unshift(e.model);
        state.missing[e.model.id] = e.missing;
        pushLog(`workflow « ${e.model.name} » : ${e.analysis.tasks.map((t) => TASK_LABEL[t]).join(", ")}${e.analysis.warnings.length ? " · " + e.analysis.warnings.join(" ; ") : ""}${e.missing.length ? " · nœuds manquants : " + e.missing.join(", ") : ""}`);
      }
      renderModels();
      renderStatus();
      renderSettingsWorkflows();
      return;
    case "api":
      state.api = e;
      $("ai-badge").hidden = !e.enabled;
      renderStatus();
      return;
    case "queued": {
      // Tâche lancée par une IA ou un script : on la montre.
      const job = { ...blankJob(e.task), model: e.model, prompt: e.prompt };
      state.queue.push({ id: e.id, origin: e.origin, job, state: "waiting", stages: {} });
      renderQueue();
      return;
    }
    case "exited":
      state.engine = "off";
      for (const q of state.queue) if (q.state === "running") (q.state = "error"), (q.error = "le moteur s'est arrêté");
      render();
      return;
    case "log":
      pushLog(e.text);
      return;
    case "loaded":
      state.loaded = e.model;
      if (e.id === -1) state.engine = "ready";
      renderLoaded();
      renderEngineBadge();
      return;
    case "unloaded":
      state.loaded = null;
      if (e.id === -1) state.engine = "ready";
      renderLoaded();
      renderEngineBadge();
      return;
    case "policy":
      state.autoLoad = e.auto_load;
      renderLoaded();
      return;
  }
  let q = state.queue.find((x) => x.id === e.id);
  if (!q && "origin" in e && e.origin && typeof e.id === "number" && e.id >= 1_000_000) {
    q = { id: e.id, origin: e.origin, job: blankJob("t2i"), state: "running", stages: {} };
    state.queue.push(q);
  }
  if (q?.origin && e.event === "stage" && q.state === "waiting") q.state = "running";
  if (!q) {
    if (e.event === "error") {
      pushLog(`erreur : ${e.message}`);
      if (e.id === -1) {
        state.engine = "ready";
        renderEngineBadge();
        renderLoaded();
      }
    }
    return;
  }
  switch (e.event) {
    case "stage":
      q.stages[e.stage] = { label: e.label, seconds: e.seconds, running: e.status === "start", ok: e.ok ?? true };
      if (e.stage === "sample" && e.status === "start") q.progress = undefined;
      renderStages();
      return;
    case "progress":
      q.progress = { step: e.step, total: e.total, sps: e.seconds_per_step };
      renderStages();
      return;
    case "done": {
      q.state = "done";
      q.done = e;
      if (q.origin) q.job = { ...q.job, task: e.task, width: e.width, height: e.height };
      state.lastDone = q;
      state.engine = "ready";
      const run: Run = { at: Date.now(), job: q.job, done: e };
      state.runs.unshift(run);
      void api.recordRun(run);
      render();
      void pump();
      return;
    }
    case "cancelled":
      q.state = "cancelled";
      state.engine = "ready";
      render();
      void pump();
      return;
    case "error":
      q.state = "error";
      q.error = e.message;
      pushLog(`erreur #${q.id} : ${e.message}`);
      if (e.trace) pushLog(e.trace);
      state.engine = "ready";
      render();
      void pump();
      return;
  }
}

// ---------- réglages ----------

async function openSettings() {
  const dlg = $<HTMLDialogElement>("settings");
  const st = await api.status();
  const s = structuredClone(state.settings!);
  const py = $<HTMLSelectElement>("s-python");
  py.replaceChildren(...st.pythons.map((p) => h("option", { value: p.command, selected: p.command === s.python || undefined }, `${p.command} (${p.version})`)));
  if (!st.pythons.length) py.replaceChildren(h("option", { value: "" }, "aucun Python 3.10–3.13 trouvé — installe-le depuis python.org"));
  $("s-engine-state").textContent = st.engine_installed ? `installé dans ${st.venv}` : "non installé";
  $<HTMLInputElement>("s-out").value = s.out_dir;
  $<HTMLInputElement>("s-comfy-dir").value = s.comfy_dir ?? "";
  $<HTMLInputElement>("s-comfy-python").value = s.comfy_python ?? "";
  $<HTMLInputElement>("s-comfy-port").value = String(s.comfy_port || 8188);
  $<HTMLInputElement>("s-ai").checked = !!s.ai_control;
  $<HTMLInputElement>("s-api-port").value = String(s.api_port || 8765);
  $<HTMLInputElement>("s-api-token").value = s.api_token ?? "";
  $("s-mcp").textContent = st.mcp_command.replace(/--url http:\/\/127\.0\.0\.1:\d+/, `--url http://127.0.0.1:${s.api_port || 8765}`) + (s.api_token ? ` --token ${s.api_token}` : "");
  renderSettingsComfy();
  renderSettingsWorkflows();
  $("s-pick-comfy").onclick = async () => {
    const p = await api.pickFolder();
    if (p) $<HTMLInputElement>("s-comfy-dir").value = p;
  };
  const readComfy = () => {
    s.comfy_dir = $<HTMLInputElement>("s-comfy-dir").value.trim() || null;
    s.comfy_python = $<HTMLInputElement>("s-comfy-python").value.trim() || null;
    s.comfy_port = Number($<HTMLInputElement>("s-comfy-port").value) || 8188;
  };
  const syncComfy = async () => {
    readComfy();
    await api.saveSettings(s);
    state.settings = structuredClone(s);
    if (await ensureEngine()) await probe();
  };
  $("s-comfy-start").onclick = async () => {
    await syncComfy();
    $("s-comfy-state").textContent = "démarrage de ComfyUI…";
    await api.send({ id: -4, cmd: "comfy_start" });
  };
  $("s-comfy-stop").onclick = () => void api.send({ id: -4, cmd: "comfy_stop" });
  $("s-wf-import").onclick = async () => {
    const p = await api.pickJson();
    if (!p) return;
    await syncComfy();
    await api.send({ id: -5, cmd: "workflow_import", path: p });
  };
  const paths = $("s-paths");
  const renderPaths = () =>
    paths.replaceChildren(
      ...s.model_paths.map((p, i) => {
        const b = h("button", { type: "button", class: "link" }, "retirer");
        b.onclick = () => {
          s.model_paths.splice(i, 1);
          renderPaths();
        };
        return h("div", { class: "path-row mono small" }, h("span", {}, p), b);
      }),
    );
  renderPaths();
  $("s-add-path").onclick = async () => {
    const p = await api.pickFolder();
    if (p && !s.model_paths.includes(p)) {
      s.model_paths.push(p);
      renderPaths();
    }
  };
  $("s-pick-out").onclick = async () => {
    const p = await api.pickFolder();
    if (p) $<HTMLInputElement>("s-out").value = p;
  };
  const log = $<HTMLPreElement>("s-setup-log");
  $("s-install").onclick = async () => {
    s.python = py.value || null;
    s.out_dir = $<HTMLInputElement>("s-out").value;
    await api.saveSettings(s);
    state.settings = structuredClone(s);
    log.hidden = false;
    log.textContent = "";
    state.engine = "off";
    renderEngineBadge();
    $("s-install").setAttribute("disabled", "");
    try {
      await api.setupEngine();
      $("s-engine-state").textContent = `installé dans ${st.venv}`;
    } catch (e) {
      log.textContent += `\n✗ ${e}`;
    } finally {
      $("s-install").removeAttribute("disabled");
    }
  };
  $("s-restart").onclick = async () => {
    await api.stopEngine();
    state.engine = "off";
    await ensureEngine();
  };
  dlg.returnValue = "";
  dlg.showModal();
  await new Promise<void>((r) => dlg.addEventListener("close", () => r(), { once: true }));
  if (dlg.returnValue !== "save") return;
  s.python = py.value || null;
  s.out_dir = $<HTMLInputElement>("s-out").value.trim();
  readComfy();
  s.ai_control = $<HTMLInputElement>("s-ai").checked;
  s.api_port = Number($<HTMLInputElement>("s-api-port").value) || 8765;
  s.api_token = $<HTMLInputElement>("s-api-token").value.trim() || null;
  await api.saveSettings(s);
  state.settings = structuredClone(s);
  if (state.engine === "ready") {
    void probe();
  } else if (s.ai_control && (await ensureEngine())) {
    // probe (lancé par « ready ») appliquera le pilotage IA.
  }
}

function renderSettingsComfy() {
  const el = document.getElementById("s-comfy-state");
  if (!el) return;
  const c = state.comfy;
  if (!c) return void (el.textContent = "");
  if (!c.found) return void (el.textContent = c.dir ? "main.py introuvable dans ce dossier" : "aucun dossier ComfyUI indiqué");
  el.textContent = `ComfyUI ${c.version ?? "?"} · Python ${c.python ? "trouvé" : "introuvable (indique-le)"} · ${c.running ? (c.external ? "serveur déjà ouvert, utilisé tel quel" : "en marche en arrière-plan") : "arrêté"} · ${c.custom_nodes.length} nœud(s) personnalisé(s)`;
}

function renderSettingsWorkflows() {
  const box = document.getElementById("s-workflows");
  if (!box) return;
  const wfs = state.models.filter((m) => m.backend === "comfy" && m.format === "workflow");
  box.replaceChildren(
    ...(wfs.length ? wfs : []).map((m) => {
      const miss = state.missing[m.id];
      return h("div", { class: "path-row small" }, h("span", {}, `${m.name} — ${m.tasks.map((t) => TASK_LABEL[t]).join(", ")}${m.supported ? "" : ` — ${m.note}`}`),
        miss?.length ? h("span", { class: "missing" }, `manque : ${miss.join(", ")}`) : miss ? h("span", { class: "ok" }, "nœuds OK") : "");
    }),
  );
  if (!wfs.length) box.replaceChildren(h("div", { class: "muted small" }, "Aucun workflow importé."));
}

// ---------- branchements ----------

async function main() {
  api = await backend;
  state.settings = await api.getSettings();
  // Historique d'anciennes versions : champs manquants complétés.
  state.runs = (await api.listRuns(50)).map((r) => ({
    ...r,
    job: { task: "i2v", strength: 0.6, ...(r.job as Partial<JobSpec>) } as JobSpec,
    done: { kind: "video", task: "i2v", ...(r.done as Partial<Done>) } as Done,
  }));
  api.onEngine(onEngine);
  api.onEngineLog(pushLog);
  api.onSetup((l) => {
    const log = $<HTMLPreElement>("s-setup-log");
    log.hidden = false;
    log.textContent += l + "\n";
    log.scrollTop = log.scrollHeight;
  });
  api.onDrop((paths) => {
    const img = paths.find((p) => /\.(png|jpe?g|webp|bmp)$/i.test(p));
    if (img) {
      state.image = img;
      showImage(img);
    }
  });

  const ui = (state.settings.ui ?? {}) as Record<string, string>;
  if (ui.negative !== undefined) $<HTMLTextAreaElement>("negative").value = ui.negative;
  else $<HTMLTextAreaElement>("negative").value = "worst quality, inconsistent motion, blurry, jittery, distorted";

  $("drop").onclick = async () => {
    const p = await api.pickImage();
    if (p) {
      state.image = p;
      showImage(p);
    }
  };
  $<HTMLSelectElement>("res").onchange = () => {
    $("custom-res").hidden = $<HTMLSelectElement>("res").value !== "custom";
    renderEstimate();
  };
  for (const id of ["orient", "seconds", "width", "height", "steps", "model"]) $(id).addEventListener("change", id === "model" ? renderModelNote : renderEstimate);
  for (const id of ["opt-audio", "opt-seedlock", "opt-sage", "opt-compile"]) {
    $(id).onclick = () => $(id).setAttribute("aria-pressed", String(!pressed(id)));
  }
  document.querySelectorAll<HTMLButtonElement>("#mode button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode as "draft" | "final")));
  setMode("draft");
  setKind("video", false);

  $("generate").onclick = async () => {
    const job = buildJob();
    if (typeof job === "string") return void pushLog(job);
    const count = state.kind === "image" ? Math.min(16, Math.max(1, Number($<HTMLInputElement>("count").value) || 1)) : 1;
    for (let i = 0; i < count; i++) {
      // Plusieurs images : graines consécutives, pour retrouver chacune.
      state.queue.push({ id: state.nextId++, job: { ...job, seed: (job.seed ?? 0) + i }, state: "waiting", stages: {} });
    }
    renderQueue();
    state.settings!.ui = { ...(state.settings!.ui ?? {}), [`model_${state.kind}`]: job.model, negative: job.negative_prompt };
    // Un workflow ComfyUI : on vérifie ses nœuds au passage.
    if (selectedModel()?.backend === "comfy" && !(job.model in state.missing)) void api.send({ id: -5, cmd: "workflow_check", model: job.model });
    void api.saveSettings(state.settings!);
    if (await ensureEngine()) void pump();
  };
  document.querySelectorAll<HTMLButtonElement>("#kind button").forEach((b) => (b.onclick = () => setKind(b.dataset.kind as Kind)));
  document.querySelectorAll<HTMLButtonElement>("#source button").forEach((b) => (b.onclick = () => setSource(b.dataset.source as "image" | "prompt")));
  $<HTMLInputElement>("strength").oninput = () => ($("strength-val").textContent = $<HTMLInputElement>("strength").value.replace(".", ","));
  $("load-btn").onclick = async () => {
    const m = selectedModel();
    if (!m || !(await ensureEngine())) return;
    state.engine = "busy";
    renderEngineBadge();
    renderLoaded();
    await api.send({ id: -1, cmd: "load", model: m.id });
  };
  $("unload-btn").onclick = async () => {
    if (state.engine !== "ready") return;
    state.engine = "busy";
    renderEngineBadge();
    await api.send({ id: -1, cmd: "unload" });
  };
  $("opt-autoload").onclick = async () => {
    state.autoLoad = !state.autoLoad;
    renderLoaded();
    if (state.engine === "ready" || state.engine === "busy") await api.send({ id: -2, cmd: "policy", auto_load: state.autoLoad });
  };
  $("cancel").onclick = () => void api.send({ cmd: "cancel" });
  $("reveal").onclick = () => state.lastDone?.done && void api.revealPath(state.lastDone.done.path);
  $("to-final").onclick = () => {
    const q = state.lastDone;
    if (!q) return;
    applyJob(q.job);
    setMode("final");
    // Même graine, résolution cible (le double du brouillon).
    $<HTMLInputElement>("width").value = String(q.job.width * 2);
    $<HTMLInputElement>("height").value = String(q.job.height * 2);
    renderEstimate();
  };
  $("open-settings").onclick = () => void openSettings();

  render();
  const first = (await api.startupPaths()).find((p) => /\.(png|jpe?g|webp|bmp)$/i.test(p));
  if (first) {
    state.image = first;
    showImage(first);
  }
  const st = await api.status();
  state.status = st;
  if (!st.engine_installed) {
    pushLog("Bienvenue. Le moteur Python n'est pas encore installé : ouvre les réglages (⚙) pour l'installer et indiquer le dossier de tes modèles.");
    if (!state.settings.model_paths.length) void openSettings();
  } else {
    await ensureEngine();
  }
}

void main();
