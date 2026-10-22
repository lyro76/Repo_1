//! Clients LLM. Deux familles seulement :
//! - local : n'importe quel serveur compatible OpenAI (`/v1/chat/completions`) ;
//! - API : Claude via l'API Anthropic (`/v1/messages`).
//!
//! Le reste du moteur ne voit que [`Backend`] et ces types neutres.

mod anthropic;
mod openai;
pub mod sse;
mod text_tools;

use anyhow::Result;
use serde::Serialize;
use serde_json::Value;

pub use anthropic::Anthropic;
pub use openai::OpenAiCompat;

use crate::config::Config;

#[derive(Debug, Clone, Serialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub args: Value,
}

#[derive(Debug, Clone)]
pub enum Msg {
    User(String),
    Assistant { text: String, tool_calls: Vec<ToolCall>, raw: Option<Value> },
    ToolResult { id: String, name: String, content: String, is_error: bool },
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub schema: Value,
}

#[derive(Debug, Clone)]
pub struct Reply {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    /// Contenu brut à renvoyer tel quel au tour suivant (blocs de réflexion
    /// Anthropic notamment : ils doivent revenir inchangés).
    pub raw: Option<Value>,
    pub truncated: bool,
}

impl Reply {
    pub fn into_msg(self) -> Msg {
        Msg::Assistant { text: self.text, tool_calls: self.tool_calls, raw: self.raw }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Which {
    Local,
    Api,
}

pub enum Backend {
    Local(OpenAiCompat),
    Api(Anthropic),
}

impl Backend {
    pub fn local(cfg: &Config) -> Self {
        Backend::Local(OpenAiCompat::new(cfg.local.clone()))
    }

    /// `None` si aucune clé n'est configurée.
    pub fn api(cfg: &Config) -> Option<Self> {
        Config::api_key().map(|key| Backend::Api(Anthropic::new(cfg.api.clone(), key)))
    }

    pub fn which(&self) -> Which {
        match self {
            Backend::Local(_) => Which::Local,
            Backend::Api(_) => Which::Api,
        }
    }

    pub fn label(&self) -> String {
        match self {
            Backend::Local(c) => format!("local · {}", c.model()),
            Backend::Api(c) => format!("api · {}", c.model()),
        }
    }

    /// Envoie la conversation ; `on_text` reçoit le texte au fur et à mesure.
    pub async fn chat(&self, system: &str, msgs: &[Msg], tools: &[ToolSpec], on_text: sse::OnText<'_>) -> Result<Reply> {
        match self {
            Backend::Local(c) => c.chat(system, msgs, tools, on_text).await,
            Backend::Api(c) => c.chat(system, msgs, tools, on_text).await,
        }
    }
}
