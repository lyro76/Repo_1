use std::path::{Path, PathBuf};

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
    /// Lance aussi les tests quand le build passe, et corrige leurs échecs.
    #[serde(default = "yes")]
    pub fix_tests: bool,
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

    /// `%APPDATA%\digital-arms` sous Windows, `~/.config/digital-arms` sous Linux,
    /// `~/Library/Application Support/digital-arms` sous macOS.
    pub fn global_dir() -> Option<PathBuf> {
        dirs::config_dir().map(|d| d.join("digital-arms"))
    }

    pub fn global_path() -> Option<PathBuf> {
        Self::global_dir().map(|d| d.join(Self::FILE))
    }

    /// Vrai tant que l'assistant de premier lancement n'a pas été terminé.
    pub fn first_run() -> bool {
        Self::global_path().is_none_or(|p| !p.exists())
    }

    /// Réglages globaux seuls (ceux de l'écran Réglages).
    pub fn load_global() -> Result<Self> {
        let mut merged = toml::Table::new();
        if let Some(p) = Self::global_path() {
            merge_file(&mut merged, &p)?;
        }
        Ok(toml::Value::Table(merged).try_into()?)
    }

    pub fn save_global(&self) -> Result<()> {
        let path = Self::global_path().ok_or_else(|| anyhow::anyhow!("dossier de configuration introuvable"))?;
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(path, toml::to_string_pretty(self)?)?;
        Ok(())
    }

    /// Réglages globaux puis `<projet>/.digital-arms/config.toml` (le second
    /// l'emporte, clé par clé au niveau racine).
    pub fn load(project_root: &Path) -> Result<Self> {
        let mut merged = toml::Table::new();
        if let Some(p) = Self::global_path() {
            merge_file(&mut merged, &p)?;
        }
        merge_file(&mut merged, &project_root.join(Self::DIR).join(Self::FILE))?;
        Ok(toml::Value::Table(merged).try_into()?)
    }

    pub fn save(&self, project_root: &Path) -> Result<()> {
        let dir = project_root.join(Self::DIR);
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join(Self::FILE), toml::to_string_pretty(self)?)?;
        Ok(())
    }

    /// Écrit `build_cmd`/`test_cmd` dans la config du projet sans toucher au reste.
    pub fn save_project_commands(project_root: &Path, build: Option<&str>, test: Option<&str>) -> Result<()> {
        let path = project_root.join(Self::DIR).join(Self::FILE);
        let mut table: toml::Table = std::fs::read_to_string(&path).ok().and_then(|t| toml::from_str(&t).ok()).unwrap_or_default();
        for (k, v) in [("build_cmd", build), ("test_cmd", test)] {
            if let Some(v) = v {
                table.insert(k.into(), toml::Value::String(v.into()));
            }
        }
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(path, toml::to_string_pretty(&table)?)?;
        Ok(())
    }

    /// Clé API : variable `ANTHROPIC_API_KEY`, sinon celle enregistrée dans les réglages.
    pub fn api_key() -> Option<String> {
        Self::api_key_source().map(|(k, _)| k)
    }

    pub fn api_key_source() -> Option<(String, KeySource)> {
        if let Some(k) = std::env::var("ANTHROPIC_API_KEY").ok().filter(|k| !k.trim().is_empty()) {
            return Some((k, KeySource::Env));
        }
        let text = std::fs::read_to_string(Self::global_dir()?.join(SECRETS)).ok()?;
        let table: toml::Table = toml::from_str(&text).ok()?;
        let k = table.get("anthropic_api_key")?.as_str()?.trim().to_string();
        (!k.is_empty()).then_some((k, KeySource::Settings))
    }

    /// Enregistre (ou efface avec `None`) la clé dans un fichier séparé de la
    /// config, lisible par l'utilisateur seul sous Unix.
    pub fn set_api_key(key: Option<&str>) -> Result<()> {
        let dir = Self::global_dir().ok_or_else(|| anyhow::anyhow!("dossier de configuration introuvable"))?;
        let path = dir.join(SECRETS);
        match key.map(str::trim).filter(|k| !k.is_empty()) {
            None => {
                let _ = std::fs::remove_file(path);
            }
            Some(k) => {
                std::fs::create_dir_all(&dir)?;
                let mut t = toml::Table::new();
                t.insert("anthropic_api_key".into(), toml::Value::String(k.into()));
                std::fs::write(&path, toml::to_string(&t)?)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
                }
            }
        }
        Ok(())
    }
}

const SECRETS: &str = "secrets.toml";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum KeySource {
    Env,
    Settings,
}

fn merge_file(into: &mut toml::Table, path: &Path) -> Result<()> {
    let Ok(text) = std::fs::read_to_string(path) else { return Ok(()) };
    let table: toml::Table = toml::from_str(&text).with_context(|| format!("config invalide : {}", path.display()))?;
    into.extend(table);
    Ok(())
}
