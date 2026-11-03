//! Trouver Python, créer l'environnement du moteur et y installer les paquets.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use anyhow::{bail, Context, Result};
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::settings::data_dir;

#[derive(Debug, Clone, Serialize)]
pub struct PythonInfo {
    pub command: String,
    pub version: String,
}

const CANDIDATES: &[&[&str]] = &[
    &["py", "-3.11"],
    &["py", "-3.12"],
    &["py", "-3"],
    &["python3.11"],
    &["python3.12"],
    &["python3"],
    &["python"],
];

fn check(cmd: &[&str]) -> Option<PythonInfo> {
    let out = std::process::Command::new(cmd[0])
        .args(&cmd[1..])
        .args(["-c", "import sys;print('%d.%d.%d'%sys.version_info[:3])"])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let mut it = version.split('.').filter_map(|p| p.parse::<u32>().ok());
    let (major, minor) = (it.next()?, it.next()?);
    (major == 3 && (10..=13).contains(&minor)).then(|| PythonInfo { command: cmd.join(" "), version })
}

/// Interpréteurs utilisables (3.10 à 3.13), le meilleur d'abord.
pub fn find_pythons(extra: Option<&str>) -> Vec<PythonInfo> {
    let mut found = Vec::new();
    if let Some(p) = extra.filter(|p| !p.trim().is_empty()) {
        let parts: Vec<&str> = p.split_whitespace().collect();
        if let Some(i) = check(&parts) {
            found.push(i);
        }
    }
    for c in CANDIDATES {
        if let Some(i) = check(c) {
            if !found.iter().any(|f: &PythonInfo| f.version == i.version && f.command == i.command) {
                found.push(i);
            }
        }
    }
    found
}

pub fn venv_dir() -> PathBuf {
    data_dir().join("engine-venv")
}

pub fn venv_python() -> PathBuf {
    if cfg!(windows) {
        venv_dir().join("Scripts").join("python.exe")
    } else {
        venv_dir().join("bin").join("python")
    }
}

pub fn engine_ready() -> bool {
    venv_python().is_file() && venv_dir().join("installed.ok").is_file()
}

fn has_nvidia() -> bool {
    std::process::Command::new("nvidia-smi").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
}

/// Lance une commande en recopiant sa sortie ligne par ligne vers `log`.
async fn run_logged(mut cmd: Command, log: &(dyn Fn(String) + Send + Sync)) -> Result<()> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn()?;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    for pipe in [
        child.stdout.take().map(|p| Box::new(p) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        child.stderr.take().map(|p| Box::new(p) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
    ] {
        let Some(pipe) = pipe else { continue };
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(pipe).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let _ = tx.send(l);
            }
        });
    }
    drop(tx);
    while let Some(l) = rx.recv().await {
        log(l);
    }
    let st = child.wait().await?;
    if !st.success() {
        bail!("commande terminée avec le code {}", st.code().unwrap_or(-1));
    }
    Ok(())
}

/// Crée (ou recrée) l'environnement et installe le moteur. Long : plusieurs minutes.
pub async fn setup(python_cmd: &str, engine_src: &Path, log: &(dyn Fn(String) + Send + Sync)) -> Result<()> {
    let parts: Vec<String> = python_cmd.split_whitespace().map(String::from).collect();
    let dir = venv_dir();
    std::fs::create_dir_all(dir.parent().unwrap())?;
    let _ = std::fs::remove_file(dir.join("installed.ok"));
    if !venv_python().is_file() {
        log(format!("› création de l'environnement dans {}", dir.display()));
        let mut c = Command::new(&parts[0]);
        c.args(&parts[1..]).arg("-m").arg("venv").arg(&dir);
        run_logged(c, log).await.context("création du venv")?;
    }
    let py = venv_python();
    log("› mise à jour de pip".into());
    let mut c = Command::new(&py);
    c.args(["-m", "pip", "install", "--upgrade", "pip", "--disable-pip-version-check"]);
    run_logged(c, log).await?;

    if has_nvidia() {
        log("› torch pour CUDA (carte NVIDIA détectée) — gros téléchargement, patience".into());
        let mut c = Command::new(&py);
        c.args(["-m", "pip", "install", "--disable-pip-version-check", "-r"]).arg(engine_src.join("requirements-cuda.txt"));
        run_logged(c, log).await.context("installation de torch CUDA")?;
    } else {
        log("› pas de carte NVIDIA : torch CPU (vrais modèles très lents, moteur factice OK)".into());
        let mut c = Command::new(&py);
        c.args(["-m", "pip", "install", "--disable-pip-version-check", "torch", "--index-url", "https://download.pytorch.org/whl/cpu"]);
        run_logged(c, log).await.context("installation de torch")?;
    }
    log("› moteur et bibliothèques de modèles".into());
    let mut c = Command::new(&py);
    c.args(["-m", "pip", "install", "--disable-pip-version-check"]).arg(format!("{}[models]", engine_src.display()));
    run_logged(c, log).await.context("installation du moteur")?;
    log("› SageAttention (optionnel)".into());
    let mut c = Command::new(&py);
    c.args(["-m", "pip", "install", "--disable-pip-version-check", "sageattention"]);
    if run_logged(c, log).await.is_err() {
        log("  SageAttention non installée (pas de roue pour cette machine) : l'attention standard sera utilisée".into());
    }
    std::fs::write(dir.join("installed.ok"), "")?;
    log("✓ moteur prêt".into());
    Ok(())
}
