//! Shell Tauri : un onglet = un projet = un [`Agent`]. Les événements de
//! l'agent partent vers la webview sur le canal `agent`, les demandes
//! d'autorisation sur `approval`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use da_core::events::ApprovalRequest;
use da_core::llm::OpenAiCompat;
use da_core::conversation::{Conversation, ConversationInfo};
use da_core::memory::Notes;
use da_core::project::scaffold;
use da_core::{Agent, Config, Decision, Event, Host, Mode, Project};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Decision>>>>;

struct Tab {
    root: PathBuf,
    pending: Pending,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
}

#[derive(Default)]
struct AppState {
    tabs: Mutex<HashMap<String, Tab>>,
}

struct TauriHost {
    app: AppHandle,
    tab: String,
    pending: Pending,
}

#[derive(Clone, Serialize)]
struct Envelope<T: Serialize> {
    tab: String,
    #[serde(flatten)]
    payload: T,
}

impl Host for TauriHost {
    fn emit(&self, event: Event) {
        let _ = self.app.emit("agent", Envelope { tab: self.tab.clone(), payload: event });
    }

    fn approve(&self, request: ApprovalRequest) -> oneshot::Receiver<Decision> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(request.id, tx);
        let _ = self.app.emit("approval", Envelope { tab: self.tab.clone(), payload: request });
        rx
    }
}

#[derive(Serialize)]
struct ProjectInfo {
    tab: String,
    name: String,
    root: String,
    /// Identifiant, nom et étiquette du langage détecté (aucune liste fermée).
    lang: String,
    lang_name: String,
    lang_label: String,
    files: Vec<String>,
    notes: String,
    config: Config,
    build: Option<String>,
    test: Option<String>,
    /// Fil de la conversation en cours, tel que l'interface l'a enregistré.
    feed: serde_json::Value,
}

fn info(tab: &str, root: &PathBuf) -> Result<ProjectInfo, String> {
    let project = Project::open(root).map_err(err)?;
    let config = Config::load(&project.root).map_err(err)?;
    let kind = project.kind();
    Ok(ProjectInfo {
        tab: tab.to_string(),
        name: project.name(),
        root: project.root.display().to_string(),
        lang: kind.id,
        lang_name: kind.name,
        lang_label: kind.label,
        files: da_core::index::walk(&project.root).iter().map(|p| da_core::index::rel(p)).collect(),
        notes: Notes::new(&project.root).read(),
        build: project.build_command(&config),
        test: project.test_command(&config),
        feed: Conversation::read_feed(&project.root),
        config,
    })
}

fn err(e: impl std::fmt::Display) -> String {
    format!("{e:#}")
}

fn agent_for(app: &AppHandle, state: &AppState, tab: &str, overrides: Option<Overrides>) -> Result<Agent, String> {
    let tabs = state.tabs.lock().unwrap();
    let t = tabs.get(tab).ok_or("onglet inconnu")?;
    let host = Arc::new(TauriHost { app: app.clone(), tab: tab.to_string(), pending: t.pending.clone() });
    let project = Project::open(&t.root).map_err(err)?;
    let mut cfg = Config::load(&project.root).map_err(err)?;
    if let Some(o) = overrides {
        cfg.mode = o.mode;
        cfg.auto_fix = o.auto_fix;
        cfg.confirm_writes = o.confirm_writes;
    }
    Ok(Agent::new(project, cfg, host))
}

#[derive(serde::Deserialize)]
struct Overrides {
    mode: Mode,
    auto_fix: bool,
    confirm_writes: bool,
}

#[tauri::command]
fn open_project(state: State<AppState>, path: String) -> Result<ProjectInfo, String> {
    let root = Project::open(&path).map_err(err)?.root;
    let tab = root.display().to_string();
    state.tabs.lock().unwrap().entry(tab.clone()).or_insert(Tab { root: root.clone(), pending: Pending::default(), task: None });
    info(&tab, &root)
}

#[derive(Serialize)]
struct NewProject {
    info: ProjectInfo,
    /// Demande à lancer tout de suite : l'agent écrit le squelette.
    bootstrap: Option<String>,
}

#[tauri::command]
fn new_project(state: State<AppState>, parent: String, name: String, lang: String) -> Result<NewProject, String> {
    let s = scaffold(&PathBuf::from(parent), &name, &lang).map_err(err)?;
    let info = open_project(state, s.dir.display().to_string())?;
    Ok(NewProject { info, bootstrap: s.bootstrap })
}

#[tauri::command]
fn refresh(state: State<AppState>, tab: String) -> Result<ProjectInfo, String> {
    let root = state.tabs.lock().unwrap().get(&tab).ok_or("onglet inconnu")?.root.clone();
    info(&tab, &root)
}

#[tauri::command]
fn start_task(app: AppHandle, state: State<AppState>, tab: String, prompt: String, options: Overrides) -> Result<(), String> {
    let agent = agent_for(&app, &state, &tab, Some(options))?;
    spawn(&state, &tab, async move {
        if let Err(e) = agent.task(&prompt).await {
            agent_error(&agent, e);
        }
    })
}

#[tauri::command]
fn start_fix(app: AppHandle, state: State<AppState>, tab: String, options: Overrides) -> Result<(), String> {
    let agent = agent_for(&app, &state, &tab, Some(options))?;
    spawn(&state, &tab, async move {
        match agent.fix_turn("Corrige le build").await {
            Ok(out) => {
                let summary = if out.ok { "build OK".into() } else { format!("{} erreur(s) restantes", out.remaining.len()) };
                emit_done(&agent, out.ok, summary);
            }
            Err(e) => agent_error(&agent, e),
        }
    })
}

fn emit_done(agent: &Agent, ok: bool, summary: String) {
    agent.host().emit(Event::Done { ok, summary });
}

fn agent_error(agent: &Agent, e: anyhow::Error) {
    agent.host().emit(Event::Text { text: format!("Erreur : {e:#}") });
    agent.host().emit(Event::Done { ok: false, summary: "interrompu".into() });
}

fn spawn(state: &AppState, tab: &str, fut: impl std::future::Future<Output = ()> + Send + 'static) -> Result<(), String> {
    let mut tabs = state.tabs.lock().unwrap();
    let t = tabs.get_mut(tab).ok_or("onglet inconnu")?;
    if t.task.as_ref().is_some_and(|h| !h.inner().is_finished()) {
        return Err("l'agent travaille déjà sur ce projet".into());
    }
    t.task = Some(tauri::async_runtime::spawn(fut));
    Ok(())
}

#[tauri::command]
fn cancel(state: State<AppState>, tab: String) {
    if let Some(t) = state.tabs.lock().unwrap().get_mut(&tab) {
        if let Some(h) = t.task.take() {
            h.abort();
        }
        t.pending.lock().unwrap().clear();
    }
}

#[tauri::command]
fn answer(state: State<AppState>, tab: String, id: u64, decision: Decision) -> Result<(), String> {
    let tabs = state.tabs.lock().unwrap();
    let t = tabs.get(&tab).ok_or("onglet inconnu")?;
    let tx = t.pending.lock().unwrap().remove(&id).ok_or("demande expirée")?;
    let _ = tx.send(decision);
    Ok(())
}

#[tauri::command]
fn undo(state: State<AppState>, tab: String, snapshot: String) -> Result<Vec<String>, String> {
    let root = state.tabs.lock().unwrap().get(&tab).ok_or("onglet inconnu")?.root.clone();
    da_core::edit::Snapshot::restore(&root, &snapshot).map_err(err)
}

/// Le terminal partagé : l'utilisateur tape, la sortie revient comme événements `terminal`.
#[tauri::command]
async fn terminal(app: AppHandle, state: State<'_, AppState>, tab: String, command: String) -> Result<bool, String> {
    let (root, pending) = {
        let tabs = state.tabs.lock().unwrap();
        let t = tabs.get(&tab).ok_or("onglet inconnu")?;
        (t.root.clone(), t.pending.clone())
    };
    let host = TauriHost { app, tab, pending };
    let project = Project::open(&root).map_err(err)?;
    let out = project.run(&command, &host, Duration::from_secs(3600)).await.map_err(err)?;
    Ok(out.ok)
}

#[derive(Serialize)]
struct Status {
    local_ok: bool,
    local_detail: String,
    api_key: bool,
}

#[tauri::command]
async fn status(state: State<'_, AppState>, tab: Option<String>) -> Result<Status, String> {
    let root = tab.and_then(|t| state.tabs.lock().unwrap().get(&t).map(|t| t.root.clone()));
    let cfg = match root {
        Some(r) => Config::load(&r).map_err(err)?,
        None => Config::load_global().map_err(err)?,
    };
    let (local_ok, local_detail) = match OpenAiCompat::new(cfg.local.clone()).health().await {
        Ok(models) if models.iter().any(|m| m == &cfg.local.model) => (true, cfg.local.model.clone()),
        Ok(_) => (false, format!("{} non servi", cfg.local.model)),
        Err(_) => (false, "serveur local injoignable".into()),
    };
    Ok(Status { local_ok, local_detail, api_key: Config::api_key().is_some() })
}

fn root_of(state: &AppState, tab: &str) -> Result<PathBuf, String> {
    Ok(state.tabs.lock().unwrap().get(tab).ok_or("onglet inconnu")?.root.clone())
}

#[tauri::command]
fn save_feed(state: State<AppState>, tab: String, feed: serde_json::Value) -> Result<(), String> {
    Conversation::write_feed(&root_of(&state, &tab)?, &feed).map_err(err)
}

/// Archive la conversation en cours ; l'agent repart sans mémoire.
#[tauri::command]
fn new_conversation(state: State<AppState>, tab: String) -> Result<(), String> {
    Conversation::archive_current(&root_of(&state, &tab)?).map_err(err)
}

#[tauri::command]
fn list_conversations(state: State<AppState>, tab: String) -> Result<Vec<ConversationInfo>, String> {
    Ok(Conversation::list(&root_of(&state, &tab)?))
}

/// Reprend une conversation archivée ; renvoie son fil.
#[tauri::command]
fn restore_conversation(state: State<AppState>, tab: String, id: String) -> Result<serde_json::Value, String> {
    let root = root_of(&state, &tab)?;
    Conversation::restore(&root, &id).map_err(err)?;
    Ok(Conversation::read_feed(&root))
}

#[derive(Serialize)]
struct Settings {
    /// Réglages globaux (ceux de l'écran Réglages).
    config: Config,
    /// D'où vient la clé API : `env`, `settings`, ou absente.
    api_key: Option<da_core::config::KeySource>,
    first_run: bool,
    config_path: String,
}

#[tauri::command]
fn get_settings() -> Result<Settings, String> {
    Ok(Settings {
        config: Config::load_global().map_err(err)?,
        api_key: Config::api_key_source().map(|(_, src)| src),
        first_run: Config::first_run(),
        config_path: Config::global_path().map(|p| p.display().to_string()).unwrap_or_default(),
    })
}

/// `api_key` : `None` = inchangée, `""` = supprimée.
#[tauri::command]
fn save_settings(config: Config, api_key: Option<String>) -> Result<(), String> {
    config.save_global().map_err(err)?;
    if let Some(k) = api_key {
        Config::set_api_key(Some(k.as_str()).filter(|k| !k.trim().is_empty())).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
async fn detect_setup(base_url: String) -> Result<da_core::setup::Setup, String> {
    Ok(da_core::setup::detect(&base_url).await)
}

#[tauri::command]
async fn probe_server(base_url: String) -> Result<da_core::setup::Probe, String> {
    Ok(da_core::setup::probe(&base_url).await)
}

/// Télécharge un modèle Ollama ; la progression part sur l'événement `pull`.
#[tauri::command]
async fn pull_model(app: AppHandle, base_url: String, model: String) -> Result<(), String> {
    da_core::setup::pull(&base_url, &model, |p| {
        let _ = app.emit("pull", &p);
    })
    .await
    .map_err(err)
}

#[tauri::command]
fn save_config(state: State<AppState>, tab: String, config: Config) -> Result<(), String> {
    let root = state.tabs.lock().unwrap().get(&tab).ok_or("onglet inconnu")?.root.clone();
    config.save(&root).map_err(err)
}

/// Dossiers passés en argument (`digital-arms ~/projets/moteur-rust`).
#[tauri::command]
fn startup_paths() -> Vec<String> {
    std::env::args().skip(1).filter(|a| !a.starts_with('-')).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            save_feed, new_conversation, list_conversations, restore_conversation, get_settings, save_settings, detect_setup, probe_server, pull_model, startup_paths, open_project, new_project, refresh, start_task, start_fix, cancel, answer, undo, terminal, status, save_config
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Digital Arms");
}
