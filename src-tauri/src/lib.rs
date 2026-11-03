//! Video Arms : coque de bureau. Tout le travail est fait par le moteur
//! Python (`engine/`) ; ici on gère la configuration, l'installation du
//! moteur, son processus, et les dialogues système.

mod engine;
mod python;
mod settings;

use std::io::Write;
use std::sync::Mutex;

use engine::EngineState;
use serde::Serialize;
use settings::{data_dir, Settings};
use tauri::{AppHandle, Emitter, State};

fn err(e: impl std::fmt::Display) -> String {
    format!("{e:#}")
}

#[derive(Serialize)]
struct Status {
    engine_installed: bool,
    engine_running: bool,
    venv: String,
    pythons: Vec<python::PythonInfo>,
    engine_src: String,
    runs_path: String,
}

#[tauri::command]
fn status(app: AppHandle, engine: State<EngineState>, settings: State<Mutex<Settings>>) -> Status {
    let s = settings.lock().unwrap();
    Status {
        engine_installed: python::engine_ready(),
        engine_running: engine.0.lock().unwrap().is_some(),
        venv: python::venv_dir().display().to_string(),
        pythons: python::find_pythons(s.python.as_deref()),
        engine_src: engine::engine_src(&app).display().to_string(),
        runs_path: runs_path().display().to_string(),
    }
}

#[tauri::command]
fn get_settings(settings: State<Mutex<Settings>>) -> Settings {
    settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(settings: State<Mutex<Settings>>, new: Settings) -> Result<(), String> {
    new.save().map_err(err)?;
    *settings.lock().unwrap() = new;
    Ok(())
}

/// Installe le moteur (long). Progression sur l'événement « setup ».
#[tauri::command]
async fn setup_engine(app: AppHandle, settings: State<'_, Mutex<Settings>>, engine: State<'_, EngineState>) -> Result<(), String> {
    stop_engine_inner(&engine).await;
    let python = settings.lock().unwrap().python.clone().unwrap_or_default();
    let python = if python.trim().is_empty() {
        python::find_pythons(None).into_iter().next().map(|p| p.command).ok_or("aucun Python 3.10–3.13 trouvé : installe-le depuis python.org (coche « Add to PATH »)")?
    } else {
        python
    };
    let src = engine::engine_src(&app);
    let h = app.clone();
    let log = move |l: String| {
        let _ = h.emit("setup", l);
    };
    python::setup(&python, &src, &log).await.map_err(|e| {
        let _ = app.emit("setup", format!("✗ {e:#}"));
        err(e)
    })
}

#[tauri::command]
async fn start_engine(app: AppHandle, engine: State<'_, EngineState>) -> Result<(), String> {
    stop_engine_inner(&engine).await;
    let e = engine::start(&app, &python::venv_python()).await.map_err(err)?;
    *engine.0.lock().unwrap() = Some(e);
    Ok(())
}

async fn stop_engine_inner(engine: &EngineState) {
    let e = engine.0.lock().unwrap().take();
    if let Some(e) = e {
        e.stop().await;
    }
}

#[tauri::command]
async fn stop_engine(engine: State<'_, EngineState>) -> Result<(), String> {
    stop_engine_inner(&engine).await;
    Ok(())
}

/// Envoie une commande brute au moteur (probe, generate, cancel, unload).
#[tauri::command]
async fn engine_send(engine: State<'_, EngineState>, msg: serde_json::Value) -> Result<(), String> {
    // On sort l'Engine du Mutex le temps de l'écriture asynchrone.
    let mut e = engine.0.lock().unwrap().take().ok_or("le moteur n'est pas lancé")?;
    let r = e.send(&msg).await;
    *engine.0.lock().unwrap() = Some(e);
    r.map_err(err)
}

#[tauri::command]
async fn pick_image(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "bmp"])
        .pick_file(move |f| {
            let _ = tx.send(f.map(|p| p.to_string()));
        });
    rx.await.ok().flatten()
}

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |f| {
        let _ = tx.send(f.map(|p| p.to_string()));
    });
    rx.await.ok().flatten()
}

fn runs_path() -> std::path::PathBuf {
    data_dir().join("runs.jsonl")
}

/// Historique des générations (profil par étape, VRAM, réglages).
#[tauri::command]
fn record_run(run: serde_json::Value) -> Result<(), String> {
    std::fs::create_dir_all(data_dir()).map_err(err)?;
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(runs_path()).map_err(err)?;
    writeln!(f, "{}", run).map_err(err)
}

#[tauri::command]
fn list_runs(limit: usize) -> Vec<serde_json::Value> {
    let text = std::fs::read_to_string(runs_path()).unwrap_or_default();
    let mut v: Vec<serde_json::Value> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    v.reverse();
    v.truncate(limit);
    v
}

#[tauri::command]
fn startup_paths() -> Vec<String> {
    std::env::args().skip(1).filter(|a| !a.starts_with('-')).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(EngineState::default())
        .manage(Mutex::new(Settings::load()))
        .invoke_handler(tauri::generate_handler![
            status, get_settings, save_settings, setup_engine, start_engine, stop_engine, engine_send,
            pick_image, pick_folder, record_run, list_runs, startup_paths
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Video Arms");
}
