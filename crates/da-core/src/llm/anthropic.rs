use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use super::{Msg, Reply, ToolCall, ToolSpec};
use crate::config::ApiConfig;

const API_VERSION: &str = "2026-10-21";
/// `fallbacks: "default"` : sur un refus des classifieurs, l'API relance la
/// requête sur le modèle de repli recommandé, dans le même appel.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

/// Claude via l'API Anthropic, en HTTP brut (pas de SDK Rust officiel).
pub struct Anthropic {
    cfg: ApiConfig,
    key: String,
    http: reqwest::Client,
}

impl Anthropic {
    pub fn new(cfg: ApiConfig, key: String) -> Self {
        let http = reqwest::Client::builder().timeout(Duration::from_secs(600)).build().expect("client http");
        Self { cfg, key, http }
    }

    pub fn model(&self) -> &str {
        &self.cfg.model
    }

    fn supports_default_fallback(&self) -> bool {
        ["claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"].iter().any(|p| self.cfg.model.starts_with(p))
    }

    pub async fn chat(&self, system: &str, msgs: &[Msg], tools: &[ToolSpec]) -> Result<Reply> {
        let mut body = json!({
            "model": self.cfg.model,
            "max_tokens": 16000,
            // Le prompt système et les outils ne changent pas d'un tour à
            // l'autre : on les met en cache.
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "messages": to_messages(msgs),
            "output_config": {"effort": self.cfg.effort},
        });
        if !tools.is_empty() {
            body["tools"] = tools
                .iter()
                .map(|t| json!({"name": t.name, "description": t.description, "input_schema": t.schema}))
                .collect();
        }
        let mut req = self
            .http
            .post(format!("{}/v1/messages", self.cfg.base_url.trim_end_matches('/')))
            .header("x-api-key", &self.key)
            .header("anthropic-version", API_VERSION);
        if self.supports_default_fallback() {
            body["fallbacks"] = json!("default");
            req = req.header("anthropic-beta", FALLBACK_BETA);
        }

        let resp = req.json(&body).send().await.context("API Anthropic injoignable")?;
        let status = resp.status();
        let v: Value = resp.json().await.context("réponse non JSON de l'API")?;
        if !status.is_success() {
            let kind = v["error"]["type"].as_str().unwrap_or("erreur");
            let msg = v["error"]["message"].as_str().unwrap_or_default();
            bail!("API Anthropic {status} ({kind}) : {msg}");
        }
        // Toujours vérifier stop_reason avant de lire le contenu.
        match v["stop_reason"].as_str() {
            Some("refusal") => {
                let cat = v["stop_details"]["category"].as_str().unwrap_or("non précisée");
                bail!("l'API a décliné la requête (catégorie : {cat}). Reformule la demande ou reste en local.");
            }
            Some("pause_turn") => bail!("tour interrompu par l'API (pause_turn) — relance la tâche"),
            _ => {}
        }

        let content = v["content"].as_array().cloned().unwrap_or_default();
        let mut text = String::new();
        let mut tool_calls = Vec::new();
        for block in &content {
            match block["type"].as_str() {
                Some("text") => text.push_str(block["text"].as_str().unwrap_or_default()),
                Some("tool_use") => tool_calls.push(ToolCall {
                    id: block["id"].as_str().unwrap_or_default().to_string(),
                    name: block["name"].as_str().unwrap_or_default().to_string(),
                    args: block["input"].clone(),
                }),
                _ => {}
            }
        }
        Ok(Reply { text, tool_calls, raw: Some(Value::Array(content)), truncated: v["stop_reason"] == "max_tokens" })
    }
}

/// Convertit l'historique neutre au format Messages. Les résultats d'outils
/// consécutifs partent dans un seul message `user`.
fn to_messages(msgs: &[Msg]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for m in msgs {
        match m {
            Msg::User(t) => out.push(json!({"role": "user", "content": t})),
            Msg::Assistant { raw: Some(raw), .. } => out.push(json!({"role": "assistant", "content": raw})),
            Msg::Assistant { text, tool_calls, raw: None } => {
                // Message produit par le modèle local avant une escalade.
                let mut content = Vec::new();
                if !text.is_empty() {
                    content.push(json!({"type": "text", "text": text}));
                }
                for c in tool_calls {
                    content.push(json!({"type": "tool_use", "id": anthropic_id(&c.id), "name": c.name, "input": c.args}));
                }
                if content.is_empty() {
                    content.push(json!({"type": "text", "text": "(vide)"}));
                }
                out.push(json!({"role": "assistant", "content": content}));
            }
            Msg::ToolResult { id, content, is_error, .. } => {
                let block = json!({"type": "tool_result", "tool_use_id": anthropic_id(id), "content": content, "is_error": is_error});
                match out.last_mut() {
                    Some(last) if last["role"] == "user" && last["content"].is_array() => {
                        last["content"].as_array_mut().unwrap().push(block)
                    }
                    _ => out.push(json!({"role": "user", "content": [block]})),
                }
            }
        }
    }
    out
}

/// Les identifiants d'outils Anthropic n'acceptent que `[a-zA-Z0-9_-]`.
fn anthropic_id(id: &str) -> String {
    id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_results_are_grouped() {
        let msgs = vec![
            Msg::User("go".into()),
            Msg::Assistant {
                text: String::new(),
                tool_calls: vec![
                    ToolCall { id: "a".into(), name: "read_file".into(), args: json!({}) },
                    ToolCall { id: "b".into(), name: "read_file".into(), args: json!({}) },
                ],
                raw: None,
            },
            Msg::ToolResult { id: "a".into(), name: "read_file".into(), content: "x".into(), is_error: false },
            Msg::ToolResult { id: "b".into(), name: "read_file".into(), content: "y".into(), is_error: true },
        ];
        let out = to_messages(&msgs);
        assert_eq!(out.len(), 3);
        assert_eq!(out[2]["content"].as_array().unwrap().len(), 2);
        assert_eq!(out[2]["content"][1]["is_error"], true);
    }
}
