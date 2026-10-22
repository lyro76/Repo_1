import { backend, type Backend } from "./api";
import { DEMO_PROMPT, DEMO_TABS } from "./demo";
import { $, h } from "./dom";
import { openSettings } from "./settings";
import type { AgentEvent, ApprovalRequest, Config, Decision, Diagnostic, Mode, Options, ProjectInfo, Status } from "./types";

// ---------- état ----------

type FeedItem =
  | { kind: "user"; text: string }
  | { kind: "step"; id: number; label: string; summary?: string; ok?: boolean }
  | { kind: "text"; text: string }
  /** Réponse en cours d'écriture (jamais enregistrée). */
  | { kind: "live"; text: string }
  | { kind: "approval"; req: ApprovalRequest; answer?: Decision | "expired" }
  | { kind: "notice"; text: string; tone: "warn" | "ok" | "err" };

interface Patch {
  snapshot: string;
  file: string;
  diff: string;
  attempt: number;
  backend: string;
}

interface TermLine {
  line: string;
  stream: "stdout" | "stderr" | "agent";
}

interface TabState {
  info: ProjectInfo;
  feed: FeedItem[];
  busy: boolean;
  diags: Diagnostic[];
  patch: Patch | null;
  build: { ok: boolean; errors: number; seconds: number } | null;
  tests: { ok: boolean; failures: number; seconds: number } | null;
  terminal: TermLine[];
  modified: Set<string>;
  lastCommand: string;
  escalated: boolean;
}

const state = {
  tabs: new Map<string, TabState>(),
  order: [] as string[],
  active: null as string | null,
  mode: "auto" as Mode,
  autoFix: true,
  confirmWrites: false,
  status: null as Status | null,
  /** Réglages globaux, pour l'affichage quand aucun projet n'est ouvert. */
  defaults: null as Config | null,
  calls: { local: 0, api: 0 },
};

const cur = () => (state.active ? state.tabs.get(state.active) ?? null : null);

/** Texte de l'agent, sans HTML : blocs ```code```, `code` en ligne, sauts de ligne gardés. */
function rich(text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  text.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g).forEach((block) => {
    const fence = /^```([^\n]*)\n([\s\S]*?)(?:```)?$/.exec(block);
    if (fence) {
      f.append(h("pre", { class: "code mono", "data-lang": fence[1].trim() || undefined }, fence[2].replace(/\n$/, "")));
      return;
    }
    block.split(/(`[^`\n]+`)/g).forEach((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) f.append(h("code", {}, part.slice(1, -1)));
      else f.append(part);
    });
  });
  return f;
}

// ---------- rendu ----------

function renderTabs() {
  const nav = $("tabs");
  nav.replaceChildren(
    ...state.order.map((id) => {
      const t = state.tabs.get(id)!;
      const waiting = t.feed.some((f) => f.kind === "approval" && !f.answer);
      const dot = waiting ? "wait" : t.busy ? "busy" : "idle";
      const b = h("button", { class: `tab${id === state.active ? " active" : ""}`, title: t.info.root }, h("i", { class: `dot ${dot}` }), h("span", {}, t.info.name), h("small", { class: "mono", title: t.info.lang_name }, t.info.lang_label));
      b.onclick = () => select(id);
      return b;
    }),
  );
  document.querySelectorAll<HTMLButtonElement>("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.mode));
}

interface Dir {
  dirs: Map<string, Dir>;
  files: string[];
}

function renderTree() {
  const t = cur();
  const root: Dir = { dirs: new Map(), files: [] };
  for (const f of t?.info.files ?? []) {
    const parts = f.split("/");
    let d = root;
    for (const p of parts.slice(0, -1)) {
      if (!d.dirs.has(p)) d.dirs.set(p, { dirs: new Map(), files: [] });
      d = d.dirs.get(p)!;
    }
    d.files.push(f);
  }
  const rows: HTMLElement[] = [];
  const walk = (d: Dir, depth: number) => {
    for (const [name, sub] of [...d.dirs].sort()) {
      rows.push(h("div", { class: "row dir", style: `--d:${depth}` }, `${name}/`));
      walk(sub, depth + 1);
    }
    for (const f of d.files.sort()) {
      const mod = t!.modified.has(f);
      rows.push(h("div", { class: `row${mod ? " modified" : ""}`, style: `--d:${depth}`, title: f }, f.split("/").pop()!, mod ? h("span", { class: "m" }, "M") : null));
    }
  };
  walk(root, 0);
  $("tree").replaceChildren(...rows);

  const bullets = (t?.info.notes ?? "")
    .split("\n")
    .filter((l) => l.trim().startsWith("- "))
    .map((l) => h("div", { class: "note" }, "· ", rich(l.trim().slice(2))));
  $("notes").replaceChildren(...(bullets.length ? bullets : [h("div", { class: "note muted" }, t ? "NOTES.md vide" : "—")]));
}

function renderFeed() {
  const t = cur();
  const feed = $("feed");
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  $("conv-project").textContent = t?.info.name ?? "";
  const badge = $("agent-badge");
  badge.className = `badge${t?.busy ? " on" : ""}`;
  badge.textContent = t?.busy ? "Agent en cours" : "";
  $("stop").hidden = !t?.busy;
  $("new-conv").toggleAttribute("disabled", !t || t.busy || !t.feed.length);
  $("history").toggleAttribute("disabled", !t || t.busy);

  if (!t) {
    feed.replaceChildren(h("div", { class: "empty" }, h("img", { src: "/logo.png", alt: "Digital Arms" }), h("p", {}, "Ouvre ou crée un projet avec ", h("b", {}, "+"), " pour commencer.")));
    return;
  }
  const items = t.feed.map((f, i): HTMLElement => {
    switch (f.kind) {
      case "user":
        return h("div", { class: "msg user" }, f.text);
      case "text":
        return h("div", { class: "msg agent" }, rich(f.text));
      case "live":
        return h("div", { class: "msg agent live", id: "live" }, f.text);
      case "notice":
        return h("div", { class: `notice ${f.tone}` }, f.text);
      case "step": {
        const tone = f.ok === undefined ? "run" : f.ok ? "ok" : "err";
        return h("div", { class: `step ${tone}` }, h("span", { class: "chev" }, "›"), h("span", { class: "label mono" }, f.label), h("span", { class: "sum mono" }, f.summary ?? "…"));
      }
      case "approval": {
        const card = h("div", { class: `approval${f.answer ? " answered" : ""}` }, h("div", { class: "title" }, h("span", { class: "warn-ico" }, "⚠"), f.req.title), h("pre", { class: "mono" }, f.req.detail));
        if (f.answer) {
          const said = { deny: "Refusé", always_allow: `Autorisé · toujours pour « ${f.req.rule} »`, allow: "Autorisé", expired: "Sans réponse (application fermée)" };
          card.append(h("div", { class: "muted small" }, said[f.answer]));
        } else {
          const act = (d: Decision) => () => answer(i, d);
          const allow = h("button", { class: "primary" }, "Autoriser");
          const deny = h("button", {}, "Refuser");
          allow.onclick = act("allow");
          deny.onclick = act("deny");
          const row = h("div", { class: "actions" }, allow, deny);
          if (f.req.rule) {
            const always = h("button", { class: "link" }, "Toujours pour ce projet");
            always.onclick = act("always_allow");
            row.append(always);
          }
          card.append(row);
        }
        return card;
      }
    }
  });
  feed.replaceChildren(...items);
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}

function diffView(diff: string): HTMLElement {
  const lines = diff.split("\n");
  const file = (lines.find((l) => l.startsWith("+++ ")) ?? "").slice(4);
  const rows: HTMLElement[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const l of lines) {
    if (l.startsWith("---") || l.startsWith("+++") || l === "") continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);
    if (hunk) {
      oldNo = +hunk[1];
      newNo = +hunk[2];
      continue;
    }
    const sign = l[0];
    const body = l.slice(1);
    if (sign === "-") rows.push(h("div", { class: "dl del" }, h("span", { class: "no" }, `- ${oldNo++}`), body));
    else if (sign === "+") rows.push(h("div", { class: "dl add" }, h("span", { class: "no" }, `+ ${newNo++}`), body));
    else {
      rows.push(h("div", { class: "dl" }, h("span", { class: "no" }, `${newNo}`), body));
      oldNo++;
      newNo++;
    }
  }
  return h("div", { class: "diff mono" }, h("div", { class: "diff-head" }, file), ...rows);
}

function renderCorrection() {
  const t = cur();
  const body = $("correction");
  const attempt = $("attempt");
  if (!t || (!t.diags.length && !t.patch && !t.build && !t.tests)) {
    attempt.textContent = "";
    attempt.hidden = true;
    body.replaceChildren(h("div", { class: "muted empty-small" }, "Aucune erreur. Le build est relancé et corrigé automatiquement après chaque tâche."));
    return;
  }
  const max = t.info.config.max_attempts;
  attempt.hidden = !t.patch;
  if (t.patch) attempt.textContent = t.patch.attempt === 0 ? "compilateur" : `tentative ${t.patch.attempt}/${max} · ${t.patch.backend}`;

  const parts: HTMLElement[] = [];
  if (t.diags.length && t.tests && !t.tests.ok) parts.push(h("div", { class: "muted small" }, "Tests en échec :"));
  for (const d of t.diags.slice(0, 3)) {
    parts.push(
      h("div", { class: "error-card" },
        h("div", { class: "err-head mono" }, d.code ? h("span", { class: "code" }, d.code) : null, h("span", {}, d.message), h("span", { class: "loc" }, d.file ? `${d.file}:${d.line}:${d.column}` : "")),
        d.notes[0] ? h("div", { class: "err-note" }, rich(d.notes[0].replace(/`/g, ""))) : null,
      ),
    );
  }
  if (t.diags.length > 3) parts.push(h("div", { class: "muted small" }, `+ ${t.diags.length - 3} autre(s)`));
  if (t.patch) parts.push(diffView(t.patch.diff));
  if (t.build) {
    parts.push(
      h("div", { class: `build-row mono ${t.build.ok ? "ok" : "err"}` },
        h("span", {}, t.build.ok ? "✓" : "✗"), h("b", {}, short(t.info.build ?? "build")), h("div", { class: "spacer" }),
        h("span", { class: "muted" }, `${t.build.errors} erreur${t.build.errors > 1 ? "s" : ""} · ${t.build.seconds.toFixed(1).replace(".", ",")} s`),
      ),
    );
  }
  if (t.tests) {
    const n = t.tests.failures;
    parts.push(
      h("div", { class: `build-row mono ${t.tests.ok ? "ok" : "err"}` },
        h("span", {}, t.tests.ok ? "✓" : "✗"), h("b", {}, short(t.info.test ?? "tests")), h("div", { class: "spacer" }),
        h("span", { class: "muted" }, `${t.tests.ok ? "passent" : `${n} échec${n > 1 ? "s" : ""}`} · ${t.tests.seconds.toFixed(1).replace(".", ",")} s`),
      ),
    );
  }
  if (t.patch) {
    const undo = h("button", {}, "Annuler ce correctif");
    undo.onclick = () => undoPatch();
    const esc = h("button", { disabled: t.busy || !state.status?.api_key ? true : undefined, title: state.status?.api_key ? "" : "ANTHROPIC_API_KEY non défini" }, "Escalader vers l'API");
    esc.onclick = () => runFix("api");
    parts.push(h("div", { class: "actions" }, undo, esc));
  }
  body.replaceChildren(...parts);
}

const short = (cmd: string) => cmd.split(/\s+/).filter((w) => !w.startsWith("--message-format")).slice(0, 3).join(" ");

function renderTerminal() {
  const t = cur();
  const term = $("term");
  const atBottom = term.scrollHeight - term.scrollTop - term.clientHeight < 30;
  $("term-cmd").textContent = t?.lastCommand ?? "";
  $("term-cmd").hidden = !t?.lastCommand;
  $("term-prompt").textContent = t ? `${t.info.root.replace(/^.*\/(?=[^/]+$)/, "~/")} $ ` : "";
  term.replaceChildren(
    ...(t?.terminal ?? []).map(({ line, stream }) => {
      let cls = stream;
      if (/^(error|fatal error)(\[|:)|: error:|Error:|FAILED/.test(line)) cls = "error" as never;
      else if (/^\s*-->|^\s*(--|──)>/.test(line)) cls = "loc" as never;
      else if (/^\s*Finished|^\s*\d+ passed/.test(line)) cls = "ok" as never;
      else if (line.startsWith("agent ›")) cls = "agentline" as never;
      const promptMatch = /^(~\/\S+) \$ (.*)$/.exec(line);
      if (promptMatch) return h("div", { class: "tl" }, h("span", { class: "path" }, promptMatch[1]), ` $ ${promptMatch[2]}`);
      return h("div", { class: `tl ${cls}` }, line);
    }),
  );
  if (atBottom) term.scrollTop = term.scrollHeight;
}

function renderStatus() {
  const t = cur();
  const s = state.status;
  const cfg = t?.info.config ?? state.defaults;
  const local = cfg?.local.model ?? "—";
  $("model-label").textContent = state.mode === "api" ? `${cfg?.api.model ?? "api"} · api` : `${local} · local`;
  const lastBuild = t?.build;
  $("status").replaceChildren(
    h("span", {}, t?.info.root ?? "aucun projet"),
    h("span", {}, h("i", { class: `dot ${s?.local_ok ? "ok" : "off"}` }), " local · ", s?.local_ok ? `${s.local_detail} · prêt` : s?.local_detail ?? "…"),
    h("span", {}, `api · ${s?.api_key ? "claude" : "non configurée"} · ${state.calls.api} appels`),
    h("span", {}, t ? `index · ${t.info.files.length} fichiers` : ""),
    h("div", { class: "spacer" }),
    lastBuild ? h("span", { class: lastBuild.ok ? "ok" : "err" }, lastBuild.ok ? "build OK" : `build · ${lastBuild.errors} erreurs`) : "",
    t?.tests ? h("span", { class: t.tests.ok ? "ok" : "err" }, t.tests.ok ? "tests OK" : `tests · ${t.tests.failures} échec(s)`) : "",
  );
}

function render() {
  renderTabs();
  renderTree();
  renderFeed();
  renderCorrection();
  renderTerminal();
  renderStatus();
}

// ---------- actions ----------

let api: Backend;

/** Fil enregistré → fil affichable : ce qui était en cours ne l'est plus. */
function restoreFeed(saved: unknown): FeedItem[] {
  if (!Array.isArray(saved)) return [];
  return (saved as FeedItem[]).filter((f) => f.kind !== "live").map((f) => {
    if (f.kind === "approval" && !f.answer) return { ...f, answer: "expired" as const };
    if (f.kind === "step" && f.ok === undefined) return { ...f, ok: false, summary: "interrompu" };
    return f;
  });
}

const saveTimers = new Map<string, number>();

/** Enregistre le fil de la conversation (regroupé, au plus une fois par seconde). */
function persist(t: TabState) {
  const tab = t.info.tab;
  clearTimeout(saveTimers.get(tab));
  saveTimers.set(
    tab,
    window.setTimeout(() => void api.saveFeed(tab, t.feed.filter((f) => f.kind !== "live").slice(-400)).catch(() => {}), 800),
  );
}

function addTab(info: ProjectInfo) {
  if (!state.tabs.has(info.tab)) {
    state.tabs.set(info.tab, { info, feed: restoreFeed(info.feed), busy: false, diags: [], patch: null, build: null, tests: null, terminal: [], modified: new Set(), lastCommand: "", escalated: false });
    state.order.push(info.tab);
  }
  select(info.tab);
}

function select(id: string) {
  state.active = id;
  const t = cur();
  if (t) {
    state.mode = t.info.config.mode;
    state.autoFix = t.info.config.auto_fix;
    state.confirmWrites = t.info.config.confirm_writes;
    syncChips();
  }
  render();
  void api.status(id).then((s) => {
    state.status = s;
    renderStatus();
    renderCorrection();
  });
}

const options = (mode: Mode = state.mode): Options => ({ mode, auto_fix: state.autoFix, confirm_writes: state.confirmWrites });

function resetRun(t: TabState) {
  t.busy = true;
  t.diags = [];
  t.patch = null;
  t.build = null;
  t.tests = null;
  t.escalated = false;
}

async function send(text: string) {
  const t = cur();
  if (!t || !text.trim() || t.busy) return;
  if (text.trim() === "/fix") return runFix(state.mode);
  t.feed.push({ kind: "user", text: text.trim() });
  resetRun(t);
  persist(t);
  render();
  try {
    await api.startTask(t.info.tab, text.trim(), options());
  } catch (e) {
    t.busy = false;
    t.feed.push({ kind: "notice", tone: "err", text: String(e) });
    render();
  }
}

async function runFix(mode: Mode) {
  const t = cur();
  if (!t || t.busy) return;
  t.feed.push({ kind: "user", text: mode === "api" ? "Corrige le build (API)" : "Corrige le build" });
  resetRun(t);
  persist(t);
  render();
  try {
    await api.startFix(t.info.tab, options(mode));
  } catch (e) {
    t.busy = false;
    t.feed.push({ kind: "notice", tone: "err", text: String(e) });
    render();
  }
}

async function answer(index: number, d: Decision) {
  const t = cur();
  const item = t?.feed[index];
  if (!t || item?.kind !== "approval") return;
  item.answer = d;
  persist(t);
  render();
  await api.answer(t.info.tab, item.req.id, d);
}

async function undoPatch() {
  const t = cur();
  if (!t?.patch) return;
  const files = await api.undo(t.info.tab, t.patch.snapshot);
  t.feed.push({ kind: "notice", tone: "warn", text: `Correctif annulé : ${files.join(", ")} restauré.` });
  files.forEach((f) => t.modified.delete(f));
  t.patch = null;
  t.build = null; // le build et les tests d'après correctif ne valent plus
  t.tests = null;
  persist(t);

  render();
}

function onEvent(tab: string, e: AgentEvent) {
  const t = state.tabs.get(tab);
  if (!t) return;
  const last = t.feed[t.feed.length - 1];
  if (e.type === "delta") {
    if (last?.kind === "live") last.text += e.text;
    else t.feed.push({ kind: "live", text: e.text });
    // Mise à jour ciblée : pas de rendu complet du fil à chaque morceau.
    const el = tab === state.active ? document.getElementById("live") : null;
    if (el && last?.kind === "live") {
      el.textContent = last.text;
      const feed = $("feed");
      if (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80) feed.scrollTop = feed.scrollHeight;
    } else if (tab === state.active) renderFeed();
    return;
  }
  // Un message complet remplace la bulle en cours ; tout autre événement la clôt.
  if (last?.kind === "live" && e.type !== "terminal" && e.type !== "usage") t.feed.pop();
  switch (e.type) {
    case "text":
      t.feed.push({ kind: "text", text: e.text });
      break;
    case "step_start":
      t.feed.push({ kind: "step", id: e.id, label: e.label });
      break;
    case "step_end": {
      const s = [...t.feed].reverse().find((f) => f.kind === "step" && f.id === e.id && f.ok === undefined);
      if (s && s.kind === "step") Object.assign(s, { summary: e.summary, ok: e.ok });
      const label = s?.kind === "step" ? s.label : "";
      if (label.startsWith("édition ") && e.ok) t.modified.add(label.slice(8));
      break;
    }
    case "terminal":
      t.terminal.push({ line: e.line, stream: e.stream });
      if (t.terminal.length > 2000) t.terminal.splice(0, t.terminal.length - 2000);
      if (e.stream === "agent" && / \$ /.test(e.line)) t.lastCommand = short(e.line.split(" $ ")[1] ?? "");
      break;
    case "diagnostics":
      t.diags = e.items;
      break;
    case "patch":
      t.patch = e;
      t.modified.add(e.file);
      break;
    case "tests":
      t.tests = e;
      if (e.ok && !t.patch) t.diags = [];
      break;
    case "build":
      t.build = e;
      // Après un correctif, on garde l'erreur affichée au-dessus du diff.
      if (e.ok && !t.patch) t.diags = [];
      break;
    case "escalated":
      t.escalated = true;
      t.feed.push({ kind: "notice", tone: "warn", text: `↑ Passage à l'API : ${e.reason}` });
      break;
    case "usage":
      state.calls[e.backend as "local" | "api"] = e.calls;
      break;
    case "done":
      t.busy = false;
      t.feed.push({ kind: "notice", tone: e.ok ? "ok" : "err", text: e.summary });
      void api.refresh(tab).then((info) => {
        t.info = { ...info, config: t.info.config };
        if (tab === state.active) renderTree();
      });
      break;
  }
  if (e.type !== "terminal" && e.type !== "usage") persist(t);
  if (tab === state.active) render();
  else renderTabs();
}

function onApproval(tab: string, req: ApprovalRequest) {
  const t = state.tabs.get(tab);
  if (!t) return;
  t.feed.push({ kind: "approval", req });
  persist(t);
  if (tab === state.active) render();
  else renderTabs();
}

function syncChips() {
  $("opt-autofix").setAttribute("aria-pressed", String(state.autoFix));
  $("opt-confirm").setAttribute("aria-pressed", String(state.confirmWrites));
}

async function newConversation() {
  const t = cur();
  if (!t || t.busy) return;
  await api.newConversation(t.info.tab);
  t.feed = [];
  t.diags = [];
  t.patch = null;
  t.build = null;
  render();
}

function closeHistory() {
  document.getElementById("history-pop")?.remove();
}

async function toggleHistory(anchor: HTMLElement) {
  if (document.getElementById("history-pop")) return closeHistory();
  const t = cur();
  if (!t) return;
  const list = await api.listConversations(t.info.tab);
  const date = (s: number) => new Date(s * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const pop = h(
    "div",
    { id: "history-pop", class: "history-pop" },
    list.length ? null : h("div", { class: "muted small empty-hist" }, "Aucune conversation archivée."),
    ...list.map((c) => {
      const b = h("button", { class: "hist-item" }, h("span", { class: "t" }, c.title), h("small", { class: "muted" }, `${date(c.started)} · ${c.turns} échange${c.turns > 1 ? "s" : ""}`));
      b.onclick = async () => {
        closeHistory();
        if (t.busy) return;
        t.feed = restoreFeed(await api.restoreConversation(t.info.tab, c.id));
        t.diags = [];
        t.patch = null;
        t.build = null;
        render();
      };
      return b;
    }),
  );
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.right = `${window.innerWidth - r.right}px`;
  document.body.append(pop);
}

/** Après un changement de réglages : modèle, mode et état du serveur à jour. */
async function afterSettings() {
  const s = await api.getSettings();
  state.defaults = s.config;
  if (!state.active) state.mode = s.config.mode;
  for (const t of state.tabs.values()) {
    try {
      t.info = { ...(await api.refresh(t.info.tab)) };
    } catch {
      t.info.config = { ...t.info.config, ...s.config };
    }
  }
  const t = cur();
  if (t) {
    state.mode = t.info.config.mode;
    state.autoFix = t.info.config.auto_fix;
    state.confirmWrites = t.info.config.confirm_writes;
    syncChips();
  }
  state.status = await api.status(state.active);
  render();
}

// ---------- branchements ----------

async function main() {
  api = await backend;
  api.onEvent(onEvent);
  api.onApproval(onApproval);

  const prompt = $<HTMLTextAreaElement>("prompt");
  $("composer").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = prompt.value;
    prompt.value = "";
    void send(text);
  });
  prompt.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      $<HTMLFormElement>("composer").requestSubmit();
    }
  });
  $("stop").onclick = () => {
    const t = cur();
    if (!t) return;
    void api.cancel(t.info.tab);
    t.busy = false;
    t.feed.push({ kind: "notice", tone: "warn", text: "Arrêté." });
    render();
  };
  $("opt-autofix").onclick = () => {
    state.autoFix = !state.autoFix;
    syncChips();
  };
  $("opt-confirm").onclick = () => {
    state.confirmWrites = !state.confirmWrites;
    syncChips();
  };
  document.querySelectorAll<HTMLButtonElement>("#mode button").forEach((b) => {
    b.onclick = () => {
      state.mode = b.dataset.mode as Mode;
      const t = cur();
      if (t) t.info.config.mode = state.mode;
      renderTabs();
      renderStatus();
    };
  });

  const termLine = $<HTMLInputElement>("term-line");
  $("term-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const t = cur();
    const cmd = termLine.value.trim();
    if (!t || !cmd) return;
    termLine.value = "";
    void api.terminal(t.info.tab, cmd).catch((e) => onEvent(t.info.tab, { type: "terminal", line: String(e), stream: "stderr" }));
  });
  $("term-clear").onclick = () => {
    const t = cur();
    if (t) t.terminal = [];
    renderTerminal();
  };

  $("new-conv").onclick = () => void newConversation();
  $("history").onclick = (ev) => {
    ev.stopPropagation();
    void toggleHistory($("history"));
  };
  document.addEventListener("click", (ev) => {
    if (!(ev.target as HTMLElement).closest("#history-pop")) closeHistory();
  });

  $("open-settings").onclick = async () => {
    if (await openSettings(api)) await afterSettings();
  };

  const dialog = $<HTMLDialogElement>("new-dialog");
  $("add-tab").onclick = () => dialog.showModal();
  $("open-existing").onclick = async () => {
    dialog.close();
    try {
      const info = await api.pickAndOpen();
      if (info) addTab(info);
    } catch (e) {
      alert(String(e));
    }
  };
  $("pick-parent").onclick = async () => {
    const p = await api.pickFolder();
    if (p) $<HTMLInputElement>("new-parent").value = p;
  };
  dialog.addEventListener("close", async () => {
    if (dialog.returnValue !== "create") return;
    const name = $<HTMLInputElement>("new-name").value.trim();
    const parent = $<HTMLInputElement>("new-parent").value.trim();
    const lang = $<HTMLInputElement>("new-lang").value.trim();
    try {
      const created = await api.newProject(parent, name, lang);
      addTab(created.info);
      // Langage sans squelette intégré : l'agent l'écrit lui-même.
      if (created.bootstrap) void send(created.bootstrap);
    } catch (e) {
      alert(String(e));
    }
  });

  // Premier lancement : l'assistant avant tout le reste.
  const settings = await api.getSettings();
  state.defaults = settings.config;
  state.mode = settings.config.mode;
  if (settings.first_run && (await openSettings(api, { welcome: true }))) await afterSettings();
  void api.status(null).then((st) => {
    if (!state.status) state.status = st;
    renderStatus();
  });

  if (api.demo) {
    for (const id of DEMO_TABS) addTab(await api.openProject(id));
    select(DEMO_TABS[0]);
    void send(DEMO_PROMPT);
    // Les autres onglets montrent leurs états : un en attente, un inactif.
    state.tabs.get("sim-cpp")!.busy = true;
    renderTabs();
  } else {
    render();
    for (const path of await api.startupPaths()) {
      try {
        addTab(await api.openProject(path));
      } catch (e) {
        console.error(e);
      }
    }
  }
}

void main();
