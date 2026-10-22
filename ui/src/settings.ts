// Fenêtre Réglages, qui sert aussi d'assistant au premier lancement :
// détection de la carte graphique et du serveur local, modèle conseillé,
// téléchargement via Ollama, clé API, comportement de l'agent.

import type { Backend } from "./api";
import { h } from "./dom";
import type { Config, Probe, PullProgress, Setup } from "./types";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function field(label: string, control: HTMLElement, hint?: string) {
  return h("label", { class: "field" }, h("span", {}, label), control, hint ? h("small", { class: "muted" }, hint) : null);
}

function input(attrs: Record<string, string | boolean | undefined>) {
  return h("input", attrs) as HTMLInputElement;
}

function check(label: string, checked: boolean) {
  const box = input({ type: "checkbox", checked: checked || undefined });
  return { box, el: h("label", { class: "check" }, box, h("span", {}, label)) };
}

const gb = (bytes: number) => (bytes / 1e9).toFixed(1).replace(".", ",");

/** Ouvre les réglages ; se résout quand la fenêtre est fermée (true si enregistré). */
export async function openSettings(api: Backend, opts: { welcome?: boolean } = {}): Promise<boolean> {
  const settings = await api.getSettings();
  const cfg: Config = structuredClone(settings.config);
  const welcome = opts.welcome ?? settings.first_run;

  // ---- modèle local
  const url = input({ value: cfg.local.base_url, spellcheck: "false" });
  const model = input({ value: cfg.local.model, list: "installed-models", spellcheck: "false" });
  const installed = h("datalist", { id: "installed-models" });
  const serverState = h("div", { class: "server-state muted" }, "…");
  const textTools = check("Appels d'outils en texte (si le modèle gère mal le tool calling)", cfg.local.text_tools);
  const testBtn = h("button", { type: "button" }, "Tester");

  // ---- détection + téléchargement
  const detect = h("div", { class: "detect" }, h("div", { class: "muted" }, "Détection de la machine…"));
  const pullName = input({ placeholder: "qwen2.5-coder:14b", spellcheck: "false" });
  const pullBtn = h("button", { type: "button" }, "Télécharger");
  const bar = h("div", { class: "bar" }, h("i", {}));
  const pullState = h("div", { class: "pull-state muted small" });
  const pullBox = h(
    "div",
    { class: "pull", hidden: true },
    h("span", { class: "muted small" }, "Télécharger un modèle avec Ollama (bibliothèque : ollama.com/library)"),
    h("div", { class: "row" }, pullName, pullBtn),
    bar,
    pullState,
  );

  // ---- API
  const keyHint =
    settings.api_key === "env" ? "Fournie par la variable ANTHROPIC_API_KEY." : settings.api_key === "settings" ? "Une clé est enregistrée." : "Sans clé, tout reste en local.";
  const key = input({ type: "password", placeholder: settings.api_key ? "•••••••• (laisser vide pour garder)" : "sk-ant-…", autocomplete: "off" });
  let deleteKey = false;
  const delKey = h("button", { type: "button", hidden: settings.api_key !== "settings" || undefined }, "Supprimer");
  delKey.onclick = () => {
    deleteKey = true;
    key.value = "";
    key.placeholder = "clé supprimée à l'enregistrement";
    delKey.hidden = true;
  };
  const apiModel = input({ value: cfg.api.model, spellcheck: "false" });
  const effort = h("select", {}, ...EFFORTS.map((e) => h("option", { value: e, selected: e === cfg.api.effort || undefined }, e))) as HTMLSelectElement;

  // ---- agent
  const mode = h(
    "select",
    {},
    ...(["auto", "local", "api"] as const).map((m) =>
      h("option", { value: m, selected: m === cfg.mode || undefined }, { auto: "Auto (local, API en renfort)", local: "Local seulement", api: "API seulement" }[m]),
    ),
  ) as HTMLSelectElement;
  const attempts = input({ type: "number", min: "1", max: "10", value: String(cfg.max_attempts) });
  const steps = input({ type: "number", min: "5", max: "200", value: String(cfg.max_steps) });
  const autoFix = check("Compiler et corriger après chaque tâche", cfg.auto_fix);
  const confirmWrites = check("Demander avant chaque écriture de fichier", cfg.confirm_writes);

  const save = h("button", { type: "submit", class: "primary" }, welcome ? "Commencer" : "Enregistrer");
  const cancel = h("button", { type: "button" }, welcome ? "Plus tard" : "Annuler");

  const dialog = h(
    "dialog",
    { class: "settings" },
    h(
      "form",
      { method: "dialog" },
      h("h2", {}, welcome ? "Bienvenue dans Digital Arms" : "Réglages"),
      welcome
        ? h("p", { class: "muted" }, "L'agent tourne sur un modèle open source installé sur ta machine. Vérifions ce qu'elle peut faire tourner.")
        : null,
      detect,
      h(
        "fieldset",
        {},
        h("legend", {}, "Modèle local"),
        field("Serveur compatible OpenAI", h("div", { class: "row" }, url, testBtn), "Ollama : http://localhost:11434/v1 · LM Studio : http://localhost:1234/v1"),
        serverState,
        field("Modèle", model),
        installed,
        pullBox,
        textTools.el,
      ),
      h(
        "fieldset",
        {},
        h("legend", {}, "API Claude (optionnel)"),
        field("Clé API", h("div", { class: "row" }, key, delKey), keyHint),
        h("div", { class: "grid2" }, field("Modèle", apiModel), field("Effort", effort)),
      ),
      h(
        "fieldset",
        {},
        h("legend", {}, "Agent"),
        field("Mode par défaut", mode),
        h("div", { class: "grid2" }, field("Tentatives de correction", attempts), field("Actions max par tâche", steps)),
        autoFix.el,
        confirmWrites.el,
      ),
      h("div", { class: "dialog-actions" }, h("small", { class: "muted path", title: settings.config_path }, settings.config_path), cancel, save),
    ),
  );
  document.body.append(dialog);

  // ---- comportements
  const showProbe = (p: Probe) => {
    installed.replaceChildren(...p.models.map((m) => h("option", { value: m })));
    serverState.className = `server-state small ${p.reachable ? "ok" : "err"}`;
    serverState.textContent = p.reachable
      ? `✓ ${p.ollama ? "Ollama" : "Serveur"} joignable · ${p.models.length} modèle${p.models.length > 1 ? "s" : ""}${p.models.includes(model.value) ? "" : ` · « ${model.value} » n'est pas installé`}`
      : "✗ Serveur injoignable";
    pullBox.hidden = !p.ollama;
  };
  let probe: Probe | null = null;
  const reprobe = async () => {
    serverState.textContent = "…";
    probe = await api.probeServer(url.value.trim());
    showProbe(probe);
  };
  testBtn.onclick = () => void reprobe();
  model.addEventListener("change", () => probe && showProbe(probe));

  const renderDetect = (s: Setup) => {
    const gpu = s.gpu ? `${s.gpu.name} · ${Math.round(s.gpu.vram_mb / 1024)} Go de VRAM` : "Aucune carte NVIDIA détectée";
    const server = s.probe.reachable
      ? `${s.probe.ollama ? "Ollama" : "Serveur local"} en marche · ${s.probe.models.length} modèle(s) installé(s)`
      : s.ollama_installed
        ? "Ollama est installé mais arrêté : lance-le, puis « Tester »."
        : "Aucun serveur local. Installe Ollama (ollama.com/download) ou LM Studio, puis « Tester ».";
    const rec = s.recommendation;
    const have = s.probe.models.includes(rec.model);
    const use = h("button", { type: "button", class: "primary" }, have ? "Utiliser" : "Télécharger");
    use.onclick = () => {
      model.value = rec.model;
      if (!have) {
        pullName.value = rec.model;
        void pull();
      } else if (probe) showProbe(probe);
    };
    detect.replaceChildren(
      h("div", { class: "detect-row" }, h("span", { class: "k" }, "Carte graphique"), h("span", {}, gpu)),
      h("div", { class: `detect-row ${s.probe.reachable ? "" : "warn"}` }, h("span", { class: "k" }, "Serveur local"), h("span", {}, server)),
      h(
        "div",
        { class: "reco" },
        h("div", {}, h("span", { class: "k" }, "Conseillé"), h("b", { class: "mono" }, rec.model)),
        h("p", { class: "muted small" }, rec.why),
        s.probe.ollama ? use : null,
      ),
    );
    probe = s.probe;
    showProbe(s.probe);
  };
  void api.detectSetup(url.value.trim()).then(renderDetect, (e) => detect.replaceChildren(h("div", { class: "err" }, String(e))));

  let pulling = false;
  const pull = async () => {
    const name = pullName.value.trim();
    if (!name || pulling) return;
    pulling = true;
    pullBtn.setAttribute("disabled", "");
    pullState.textContent = "Démarrage…";
    try {
      await api.pullModel(url.value.trim(), name);
      pullState.textContent = `✓ ${name} installé`;
      model.value = name;
      await reprobe();
    } catch (e) {
      pullState.textContent = `✗ ${e}`;
    } finally {
      pulling = false;
      pullBtn.removeAttribute("disabled");
    }
  };
  pullBtn.onclick = () => void pull();
  api.onPull((p: PullProgress) => {
    if (!dialog.isConnected) return;
    const pct = p.total ? Math.floor((p.completed / p.total) * 100) : 0;
    (bar.firstElementChild as HTMLElement).style.width = `${p.status === "success" ? 100 : pct}%`;
    pullState.textContent = p.total ? `${p.status} · ${pct} % (${gb(p.completed)} / ${gb(p.total)} Go)` : p.status;
  });

  return new Promise((resolve) => {
    cancel.onclick = () => dialog.close("cancel");
    dialog.querySelector("form")!.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      cfg.local.base_url = url.value.trim();
      cfg.local.model = model.value.trim();
      cfg.local.text_tools = textTools.box.checked;
      cfg.api.model = apiModel.value.trim() || "claude-opus-5-5";
      cfg.api.effort = effort.value;
      cfg.mode = mode.value as Config["mode"];
      cfg.max_attempts = Math.max(1, Number(attempts.value) || 3);
      cfg.max_steps = Math.max(5, Number(steps.value) || 40);
      cfg.auto_fix = autoFix.box.checked;
      cfg.confirm_writes = confirmWrites.box.checked;
      const newKey = key.value.trim() ? key.value.trim() : deleteKey ? "" : null;
      try {
        await api.saveSettings(cfg, newKey);
        dialog.close("saved");
      } catch (e) {
        alert(String(e));
      }
    });
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "saved");
      dialog.remove();
    });
    dialog.showModal();
  });
}
