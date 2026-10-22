use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// Où l'agent envoie ses requêtes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Uniquement le modèle local.
    Local,
    /// Uniquement l'API distante.
    Api,
    /// Local d'abord ; l'API planifie les tâches de création et reprend
    /// quand le local échoue `max_attempts` fois de suite.
    #[default]
    Auto,
}

/// Serveur compatible OpenAI (Ollama, LM Studio, llama.cpp, vLLM…).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConfig {
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
    /// Les petits modèles gèrent mal le tool calling natif : on peut forcer
    /// le protocole texte (bloc ```json {"tool": …}```).
    #[serde(default)]
    pub text_tools: bool,
    #[serde(default = "default_ctx")]
    pub context_tokens: usize,
}

fn default_ctx() -> usize {
    16_384
}

impl Default for LocalConfig {
    fn default() -> Self {
        Self {
            base_url: "http://localhost:11434/v1".into(),
            model: "qwen2.5-coder:14b".into(),
            api_key: None,
            text_tools: false,
            context_tokens: default_ctx(),
        }
    }
}

/// API Anthropic. La clé vient de `ANTHROPIC_API_KEY`, jamais du fichier.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiConfig {
    #[serde(default = "default_api_model")]
    pub model: String,
    /// low | medium | high | xhigh | max
    #[serde(default = "default_effort")]
    pub effort: String,
    #[serde(default = "default_api_url")]
    pub base_url: String,
}

fn default_api_model() -> String {
    "claude-opus-5-5".into()
}
fn default_effort() -> String {
    "high".into()
}
fn default_api_url() -> String {
    "https://api.anthropic.com".into()
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self { model: default_api_model(), effort: default_effort(), base_url: default_api_url() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub local: LocalConfig,
    #[serde(default)]
    pub api: ApiConfig,
    /// Tentatives de correction avant d'abandonner (ou d'escalader en Auto).
    #[serde(default = "default_attempts")]
    pub max_attempts: u32,
    /// Nombre max d'appels d'outils pour une tâche.
    #[serde(default = "default_steps")]
    pub max_steps: u32,
    /// Lance build + correction automatiquement après chaque tâche.
    #[serde(default = "yes")]
    pub auto_fix: bool,
    /// Demande une confirmation avant chaque écriture de fichier.
    #[serde(default)]
    pub confirm_writes: bool,
    /// Commandes de build/test imposées (sinon détection automatique).
    #[serde(default)]
    pub build_cmd: Option<String>,
    #[serde(default)]
    pub test_cmd: Option<String>,
}

fn default_attempts() -> u32 {
    3
}
fn default_steps() -> u32 {
    40
}
fn yes() -> bool {
    true
}

impl Default for Config {
    fn default() -> Self {
        toml::from_str("").expect("config par défaut")
    }
}

impl Config {
    pub const DIR: &'static str = ".digital-arms";
    pub const FILE: &'static str = "config.toml";

    /// Lit `~/.config/digital-arms/config.toml` puis `<projet>/.digital-arms/config.toml`
    /// (le second l'emporte, clé par clé au niveau racine).
    pub fn load(project_root: &Path) -> Result<Self> {
        let mut merged = toml::Table::new();
        let mut candidates = Vec::new();
        if let Some(home) = std::env::var_os("HOME") {
            candidates.push(Path::new(&home).join(".config/digital-arms/config.toml"));
        }
        candidates.push(project_root.join(Self::DIR).join(Self::FILE));
        for path in candidates {
            if let Ok(text) = std::fs::read_to_string(&path) {
                let table: toml::Table =
                    toml::from_str(&text).with_context(|| format!("config invalide : {}", path.display()))?;
                for (k, v) in table {
                    merged.insert(k, v);
                }
            }
        }
        Ok(toml::Value::Table(merged).try_into()?)
    }

    pub fn save(&self, project_root: &Path) -> Result<()> {
        let dir = project_root.join(Self::DIR);
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join(Self::FILE), toml::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn api_key() -> Option<String> {
        std::env::var("ANTHROPIC_API_KEY").ok().filter(|k| !k.is_empty())
    }
}
