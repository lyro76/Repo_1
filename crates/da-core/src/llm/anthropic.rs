use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use super::sse::{self, OnText};
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
        // En flux, une longue réponse peut durer : on borne la connexion et l'attente
        // entre deux morceaux, pas la durée totale.
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(300))
            .build()
            .expect("client http");
        Self { cfg, key, http }
    }

    pub fn model(&self) -> &str {
        &self.cfg.model
    }

    fn supports_default_fallback(&self) -> bool {
        ["claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"].iter().any(|p| self.cfg.model.starts_with(p))
    }

    pub async fn chat(&self, system: &str, msgs: &[Msg], tools: &[ToolSpec], on_text: OnText<'_>) -> Result<Reply> {
        let mut body = json!({
            "model": self.cfg.model,
            "max_tokens": 64000,
            "stream": true,
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
        if !status.is_success() {
            let v: Value = resp.json().await.unwrap_or_default();
            let kind = v["error"]["type"].as_str().unwrap_or("erreur");
            let msg = v["error"]["message"].as_str().unwrap_or_default();
            bail!("API Anthropic {status} ({kind}) : {msg}");
        }
        let mut acc = Accumulator::default();
        sse::read(resp, |event, data| {
            let v: Value = serde_json::from_str(data).context("événement de flux illisible")?;
            if let Some(t) = acc.push(event, &v)? {
                if let Some(cb) = on_text {
                    cb(t);
                }
            }
            Ok(event != "message_stop")
        })
        .await?;

        // Toujours vérifier stop_reason avant de lire le contenu.
        match acc.stop_reason.as_str() {
            "refusal" => {
                let cat = acc.stop_details["category"].as_str().unwrap_or("non précisée");
                bail!("l'API a décliné la requête (catégorie : {cat}). Reformule la demande ou reste en local.");
            }
            "pause_turn" => bail!("tour interrompu par l'API (pause_turn) — relance la tâche"),
            "" => bail!("flux de l'API interrompu avant la fin"),
            _ => {}
        }

        let mut text = String::new();
        let mut tool_calls = Vec::new();
        for block in &acc.blocks {
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
        let truncated = acc.stop_reason == "max_tokens";
        // Le contenu repart tel quel au tour suivant (blocs de réflexion signés compris).
        Ok(Reply { text, tool_calls, raw: Some(Value::Array(acc.blocks)), truncated })
    }
}

/// Reconstitue le message à partir des événements du flux Messages.
#[derive(Default)]
struct Accumulator {
    blocks: Vec<Value>,
    /// JSON partiel des blocs `tool_use`, par index.
    partial: std::collections::HashMap<usize, String>,
    stop_reason: String,
    stop_details: Value,
}

impl Accumulator {
    /// Applique un événement ; renvoie le texte visible nouveau, s'il y en a.
    fn push<'v>(&mut self, event: &str, v: &'v Value) -> Result<Option<&'v str>> {
        let idx = v["index"].as_u64().unwrap_or(0) as usize;
        match event {
            "content_block_start" => {
                while self.blocks.len() <= idx {
                    self.blocks.push(Value::Null);
                }
                self.blocks[idx] = v["content_block"].clone();
            }
            "content_block_delta" => {
                let d = &v["delta"];
                let Some(block) = self.blocks.get_mut(idx) else { return Ok(None) };
                let append = |block: &mut Value, key: &str, add: &str| {
                    let cur = block[key].as_str().unwrap_or_default().to_string();
                    block[key] = Value::String(cur + add);
                };
                match d["type"].as_str() {
                    Some("text_delta") => {
                        let t = d["text"].as_str().unwrap_or_default();
                        append(block, "text", t);
                        return Ok(Some(t).filter(|t| !t.is_empty()));
                    }
                    Some("thinking_delta") => append(block, "thinking", d["thinking"].as_str().unwrap_or_default()),
                    Some("signature_delta") => block["signature"] = d["signature"].clone(),
                    Some("input_json_delta") => self.partial.entry(idx).or_default().push_str(d["partial_json"].as_str().unwrap_or_default()),
                    _ => {}
                }
            }
            "content_block_stop" => {
                if let Some(json) = self.partial.remove(&idx) {
                    let input: Value = if json.trim().is_empty() { json!({}) } else { serde_json::from_str(&json).context("arguments d'outil illisibles")? };
                    if let Some(block) = self.blocks.get_mut(idx) {
                        block["input"] = input;
                    }
                }
            }
            "message_delta" => {
                if let Some(r) = v["delta"]["stop_reason"].as_str() {
                    self.stop_reason = r.to_string();
                }
                if !v["delta"]["stop_details"].is_null() {
                    self.stop_details = v["delta"]["stop_details"].clone();
                }
            }
            "error" => bail!("API Anthropic : {}", v["error"]["message"].as_str().unwrap_or("erreur dans le flux")),
            _ => {}
        }
        Ok(None)
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
    fn rebuilds_streamed_message_with_thinking_and_tool_use() {
        let events = [
            ("message_start", json!({"type": "message_start", "message": {"content": []}})),
            ("content_block_start", json!({"index": 0, "content_block": {"type": "thinking", "thinking": "", "signature": ""}})),
            ("content_block_delta", json!({"index": 0, "delta": {"type": "thinking_delta", "thinking": "Je regarde"}})),
            ("content_block_delta", json!({"index": 0, "delta": {"type": "signature_delta", "signature": "sig=="}})),
            ("content_block_stop", json!({"index": 0})),
            ("content_block_start", json!({"index": 1, "content_block": {"type": "text", "text": ""}})),
            ("content_block_delta", json!({"index": 1, "delta": {"type": "text_delta", "text": "Je lis "}})),
            ("content_block_delta", json!({"index": 1, "delta": {"type": "text_delta", "text": "le fichier."}})),
            ("content_block_stop", json!({"index": 1})),
            ("content_block_start", json!({"index": 2, "content_block": {"type": "tool_use", "id": "toolu_1", "name": "read_file", "input": {}}})),
            ("content_block_delta", json!({"index": 2, "delta": {"type": "input_json_delta", "partial_json": "{\"path\": "}})),
            ("content_block_delta", json!({"index": 2, "delta": {"type": "input_json_delta", "partial_json": "\"src/a.rs\"}"}})),
            ("content_block_stop", json!({"index": 2})),
            ("message_delta", json!({"delta": {"stop_reason": "tool_use"}})),
            ("message_stop", json!({})),
        ];
        let mut acc = Accumulator::default();
        let mut shown = String::new();
        for (e, v) in &events {
            if let Some(t) = acc.push(e, v).unwrap() {
                shown.push_str(t);
            }
        }
        assert_eq!(shown, "Je lis le fichier.");
        assert_eq!(acc.stop_reason, "tool_use");
        assert_eq!(acc.blocks[0], json!({"type": "thinking", "thinking": "Je regarde", "signature": "sig=="}));
        assert_eq!(acc.blocks[2]["input"]["path"], "src/a.rs");
    }

    #[test]
    fn stream_error_is_reported() {
        let mut acc = Accumulator::default();
        let err = acc.push("error", &json!({"error": {"type": "overloaded_error", "message": "Overloaded"}})).unwrap_err();
        assert!(err.to_string().contains("Overloaded"));
    }

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
