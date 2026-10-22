//! Premier lancement : quelle carte graphique, quel serveur local, quel
//! modèle conseiller, et téléchargement du modèle via Ollama.

use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Gpu {
    pub name: String,
    pub vram_mb: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Recommendation {
    pub model: String,
    pub why: String,
    /// Autres choix raisonnables, du plus léger au plus lourd.
    pub alternatives: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Probe {
    /// Le serveur répond sur `/models`.
    pub reachable: bool,
    /// C'est Ollama (téléchargement de modèles possible depuis l'app).
    pub ollama: bool,
    pub models: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Setup {
    pub gpu: Option<Gpu>,
    pub ollama_installed: bool,
    pub probe: Probe,
    pub recommendation: Recommendation,
}

/// Cartes NVIDIA via `nvidia-smi` (présent avec le pilote, Windows comme Linux).
pub fn detect_gpu() -> Option<Gpu> {
    let out = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    parse_nvidia_smi(&String::from_utf8_lossy(&out.stdout))
}

fn parse_nvidia_smi(text: &str) -> Option<Gpu> {
    // Plusieurs cartes : on garde la plus grosse.
    text.lines()
        .filter_map(|l| {
            let (name, mem) = l.rsplit_once(',')?;
            Some(Gpu { name: name.trim().to_string(), vram_mb: mem.trim().parse().ok()? })
        })
        .max_by_key(|g| g.vram_mb)
}

/// Modèle de code conseillé selon la mémoire vidéo (quantification Q4 d'Ollama).
pub fn recommend(gpu: Option<&Gpu>) -> Recommendation {
    let alts = |v: &[&str]| v.iter().map(|s| s.to_string()).collect();
    match gpu.map(|g| g.vram_mb) {
        None => Recommendation {
            model: "qwen2.5-coder:7b".into(),
            why: "Pas de carte NVIDIA détectée : un 7B tourne sur le processeur, lentement. Avec une carte AMD ou un Mac, \
                  Ollama l'utilisera quand même."
                .into(),
            alternatives: alts(&["qwen2.5-coder:3b", "qwen2.5-coder:7b", "qwen2.5-coder:14b"]),
        },
        Some(v) if v < 6_000 => Recommendation {
            model: "qwen2.5-coder:3b".into(),
            why: format!("{} Go de VRAM : un 3B tient entièrement en mémoire vidéo.", v / 1024),
            alternatives: alts(&["qwen2.5-coder:3b", "qwen2.5-coder:7b"]),
        },
        Some(v) if v < 9_500 => Recommendation {
            model: "qwen2.5-coder:7b".into(),
            why: format!("{} Go de VRAM : un 7B tient en mémoire vidéo avec un contexte confortable.", v / 1024),
            alternatives: alts(&["qwen2.5-coder:3b", "qwen2.5-coder:7b", "qwen2.5-coder:14b"]),
        },
        Some(v) if v < 20_000 => Recommendation {
            model: "qwen2.5-coder:14b".into(),
            why: format!(
                "{} Go de VRAM : un 14B (≈ 9 Go en Q4) tient en mémoire vidéo. Plus lent qu'un 7B, mais nettement meilleur pour corriger.",
                (v + 512) / 1024
            ),
            alternatives: alts(&["qwen2.5-coder:7b", "qwen2.5-coder:14b"]),
        },
        Some(v) => Recommendation {
            model: "qwen2.5-coder:32b".into(),
            why: format!("{} Go de VRAM : un 32B (≈ 20 Go en Q4) tient en mémoire vidéo.", v / 1024),
            alternatives: alts(&["qwen2.5-coder:14b", "qwen2.5-coder:32b"]),
        },
    }
}

/// `http://localhost:11434/v1` → `http://localhost:11434`.
pub fn server_root(base_url: &str) -> String {
    let u = base_url.trim_end_matches('/');
    u.strip_suffix("/v1").unwrap_or(u).to_string()
}

fn http(timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder().timeout(timeout).build().expect("client http")
}

pub async fn probe(base_url: &str) -> Probe {
    let client = http(Duration::from_secs(4));
    let ollama = client.get(format!("{}/api/version", server_root(base_url))).send().await.is_ok_and(|r| r.status().is_success());
    let models = async {
        let v: serde_json::Value =
            client.get(format!("{}/models", base_url.trim_end_matches('/'))).send().await?.error_for_status()?.json().await?;
        anyhow::Ok(v["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(String::from)).collect::<Vec<_>>())
    };
    match models.await {
        Ok(mut models) => {
            models.sort();
            Probe { reachable: true, ollama, models, error: None }
        }
        Err(e) => Probe { reachable: false, ollama, models: Vec::new(), error: Some(format!("{e:#}")) },
    }
}

pub fn ollama_installed() -> bool {
    std::process::Command::new("ollama").arg("--version").output().is_ok_and(|o| o.status.success())
}

pub async fn detect(base_url: &str) -> Setup {
    let gpu = tokio::task::spawn_blocking(detect_gpu).await.ok().flatten();
    let recommendation = recommend(gpu.as_ref());
    let ollama_installed = tokio::task::spawn_blocking(ollama_installed).await.unwrap_or(false);
    Setup { gpu, ollama_installed, probe: probe(base_url).await, recommendation }
}

#[derive(Debug, Clone, Serialize)]
pub struct PullProgress {
    pub status: String,
    pub completed: u64,
    pub total: u64,
}

/// Télécharge un modèle via l'API d'Ollama (`POST /api/pull`, réponse NDJSON).
pub async fn pull(base_url: &str, model: &str, mut on_progress: impl FnMut(PullProgress)) -> Result<()> {
    let url = format!("{}/api/pull", server_root(base_url));
    let mut resp = http(Duration::from_secs(6 * 3600))
        .post(&url)
        .json(&serde_json::json!({"model": model, "stream": true}))
        .send()
        .await
        .with_context(|| format!("Ollama injoignable ({url}). Est-il lancé ?"))?;
    if !resp.status().is_success() {
        bail!("Ollama {} : {}", resp.status(), resp.text().await.unwrap_or_default());
    }
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let Ok(v) = serde_json::from_slice::<serde_json::Value>(&line) else { continue };
            if let Some(e) = v["error"].as_str() {
                bail!("Ollama : {e}");
            }
            let status = v["status"].as_str().unwrap_or_default().to_string();
            let done = status == "success";
            on_progress(PullProgress { status, completed: v["completed"].as_u64().unwrap_or(0), total: v["total"].as_u64().unwrap_or(0) });
            if done {
                return Ok(());
            }
        }
    }
    bail!("téléchargement interrompu")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_nvidia_smi() {
        let g = parse_nvidia_smi("NVIDIA GeForce RTX 3080, 10240\n").unwrap();
        assert_eq!((g.name.as_str(), g.vram_mb), ("NVIDIA GeForce RTX 3080", 10240));
        let g = parse_nvidia_smi("Quadro P400, 2048\nNVIDIA RTX A6000, 49140\n").unwrap();
        assert_eq!(g.vram_mb, 49140);
        assert!(parse_nvidia_smi("").is_none());
    }

    #[test]
    fn recommendations_follow_vram() {
        let gpu = |mb| Some(Gpu { name: String::new(), vram_mb: mb });
        assert_eq!(recommend(gpu(4096).as_ref()).model, "qwen2.5-coder:3b");
        assert_eq!(recommend(gpu(8192).as_ref()).model, "qwen2.5-coder:7b");
        // RTX 3080 10 Go.
        let r = recommend(gpu(10240).as_ref());
        assert_eq!(r.model, "qwen2.5-coder:14b");
        assert!(r.why.starts_with("10 Go"));
        assert_eq!(recommend(gpu(24576).as_ref()).model, "qwen2.5-coder:32b");
        assert_eq!(recommend(None).model, "qwen2.5-coder:7b");
    }

    #[test]
    fn root_of_openai_url() {
        assert_eq!(server_root("http://localhost:11434/v1/"), "http://localhost:11434");
        assert_eq!(server_root("http://h:1234"), "http://h:1234");
    }
}
