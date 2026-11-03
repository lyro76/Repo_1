use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Interpréteur Python utilisé pour créer l'environnement du moteur.
    #[serde(default)]
    pub python: Option<String>,
    /// Dossiers où chercher les modèles (caches Hugging Face ou dossiers diffusers).
    #[serde(default)]
    pub model_paths: Vec<String>,
    #[serde(default = "default_out")]
    pub out_dir: String,
    /// Installation ComfyUI (dossier contenant main.py) ; vide = pas de ComfyUI.
    #[serde(default)]
    pub comfy_dir: Option<String>,
    /// Python de ComfyUI ; vide = détection (venv, .venv, python_embeded).
    #[serde(default)]
    pub comfy_python: Option<String>,
    #[serde(default = "default_comfy_port")]
    pub comfy_port: u16,
    /// Pilotage par une IA ou un script : API HTTP locale + connecteur MCP.
    #[serde(default)]
    pub ai_control: bool,
    #[serde(default = "default_api_port")]
    pub api_port: u16,
    #[serde(default)]
    pub api_token: Option<String>,
    /// Réglages par défaut de génération, mémorisés par l'interface.
    #[serde(default)]
    pub ui: serde_json::Value,
}

fn default_comfy_port() -> u16 {
    8188
}
fn default_api_port() -> u16 {
    8765
}

fn default_out() -> String {
    dirs::video_dir()
        .or_else(dirs::home_dir)
        .map(|d| d.join("ScreenComfy").display().to_string())
        .unwrap_or_else(|| "sorties".into())
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            python: None,
            model_paths: Vec::new(),
            out_dir: default_out(),
            comfy_dir: None,
            comfy_python: None,
            comfy_port: default_comfy_port(),
            ai_control: false,
            api_port: default_api_port(),
            api_token: None,
            ui: serde_json::Value::Null,
        }
    }
}

pub fn config_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("screencomfy")
}

/// Dossier des workflows ComfyUI importés.
pub fn workflows_dir() -> PathBuf {
    data_dir().join("workflows")
}

pub fn data_dir() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(|| PathBuf::from(".")).join("screencomfy")
}

impl Settings {
    pub fn path() -> PathBuf {
        config_dir().join("config.json")
    }

    pub fn load() -> Self {
        std::fs::read_to_string(Self::path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    pub fn save(&self) -> Result<()> {
        std::fs::create_dir_all(config_dir())?;
        std::fs::write(Self::path(), serde_json::to_string_pretty(self)?).context("écriture de la configuration")?;
        Ok(())
    }
}
