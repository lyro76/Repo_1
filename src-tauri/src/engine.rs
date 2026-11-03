//! Le moteur Python en sous-processus : commandes sur son stdin, événements
//! JSON sur son stdout (relayés tels quels à la webview sur « engine »),
//! journal sur stderr (relayé sur « engine_log »).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use anyhow::{bail, Context, Result};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};

pub struct Engine {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct EngineState(pub Mutex<Option<Engine>>);

/// Dossier source du moteur : à côté du dépôt en dev, dans les ressources en release.
pub fn engine_src(app: &AppHandle) -> PathBuf {
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../engine");
    if dev.join("pyproject.toml").is_file() {
        return dev.canonicalize().unwrap_or(dev);
    }
    tauri::Manager::path(app).resource_dir().map(|r| r.join("engine")).unwrap_or(dev)
}

pub async fn start(app: &AppHandle, python: &Path) -> Result<Engine> {
    if !python.is_file() {
        bail!("moteur non installé : ouvre les réglages et clique sur « Installer le moteur »");
    }
    let mut cmd = Command::new(python);
    cmd.args(["-X", "utf8", "-m", "videoarms.server"])
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("HF_HUB_OFFLINE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().context("lancement du moteur")?;
    let stdin = child.stdin.take().context("stdin du moteur")?;
    let stdout = child.stdout.take().context("stdout du moteur")?;
    let stderr = child.stderr.take().context("stderr du moteur")?;

    let h = app.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            match serde_json::from_str::<serde_json::Value>(&l) {
                Ok(v) => {
                    let _ = h.emit("engine", v);
                }
                Err(_) => {
                    let _ = h.emit("engine_log", l);
                }
            }
        }
        let _ = h.emit("engine", serde_json::json!({"event": "exited"}));
    });
    let h = app.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            let _ = h.emit("engine_log", l);
        }
    });
    Ok(Engine { child, stdin })
}

impl Engine {
    pub async fn send(&mut self, msg: &serde_json::Value) -> Result<()> {
        let mut line = serde_json::to_string(msg)?;
        line.push('\n');
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.flush().await?;
        Ok(())
    }

    pub async fn stop(mut self) {
        let _ = self.send(&serde_json::json!({"cmd": "quit"})).await;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), self.child.wait()).await;
        let _ = self.child.kill().await;
    }
}
