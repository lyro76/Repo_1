use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use super::{text_tools, Msg, Reply, ToolCall, ToolSpec};
use crate::config::LocalConfig;

/// Ollama, LM Studio, llama.cpp `server`, vLLM, LocalAI… tous parlent ce protocole.
pub struct OpenAiCompat {
    cfg: LocalConfig,
    http: reqwest::Client,
}

impl OpenAiCompat {
    pub fn new(cfg: LocalConfig) -> Self {
        let http = reqwest::Client::builder()
            // Un 14B sur GPU grand public peut mettre plusieurs minutes.
            .timeout(Duration::from_secs(600))
            .build()
            .expect("client http");
        Self { cfg, http }
    }

    pub fn model(&self) -> &str {
        &self.cfg.model
    }

    /// Vérifie que le serveur répond et que le modèle est servi.
    pub async fn health(&self) -> Result<Vec<String>> {
        let url = format!("{}/models", self.cfg.base_url.trim_end_matches('/'));
        let v: Value = self.auth(self.http.get(url)).send().await?.error_for_status()?.json().await?;
        Ok(v["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(String::from)).collect())
    }

    fn auth(&self, rb: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.cfg.api_key {
            Some(k) => rb.bearer_auth(k),
            None => rb,
        }
    }

    pub async fn chat(&self, system: &str, msgs: &[Msg], tools: &[ToolSpec]) -> Result<Reply> {
        let text_mode = self.cfg.text_tools && !tools.is_empty();
        let system = if text_mode { format!("{system}\n\n{}", text_tools::instructions(tools)) } else { system.to_string() };

        let mut messages = vec![json!({"role": "system", "content": system})];
        for m in msgs {
            messages.push(match m {
                Msg::User(t) => json!({"role": "user", "content": t}),
                Msg::Assistant { text, tool_calls, .. } if text_mode || tool_calls.is_empty() => {
                    json!({"role": "assistant", "content": text})
                }
                Msg::Assistant { text, tool_calls, .. } => json!({
                    "role": "assistant",
                    "content": text,
                    "tool_calls": tool_calls.iter().map(|c| json!({
                        "id": c.id, "type": "function",
                        "function": {"name": c.name, "arguments": c.args.to_string()}
                    })).collect::<Vec<_>>(),
                }),
                Msg::ToolResult { id, name, content, is_error } if text_mode => json!({
                    "role": "user",
                    "content": format!("Résultat de l'outil `{name}` ({id}){}:\n{content}", if *is_error { " — ERREUR" } else { "" }),
                }),
                Msg::ToolResult { id, content, is_error, .. } => json!({
                    "role": "tool", "tool_call_id": id,
                    "content": if *is_error { format!("ERREUR: {content}") } else { content.clone() },
                }),
            });
        }

        let mut body = json!({
            "model": self.cfg.model,
            "messages": messages,
            // Le code demande de la précision, pas de la créativité.
            "temperature": 0.2,
            "stream": false,
        });
        if !tools.is_empty() && !text_mode {
            body["tools"] = tools
                .iter()
                .map(|t| json!({"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.schema}}))
                .collect();
        }

        let url = format!("{}/chat/completions", self.cfg.base_url.trim_end_matches('/'));
        let resp = self
            .auth(self.http.post(&url).json(&body))
            .send()
            .await
            .with_context(|| format!("serveur local injoignable ({url}). Ollama ou LM Studio est-il lancé ?"))?;
        let status = resp.status();
        let v: Value = resp.json().await.context("réponse non JSON du serveur local")?;
        if !status.is_success() {
            bail!("serveur local {status}: {}", v["error"]["message"].as_str().unwrap_or(&v.to_string()));
        }

        let choice = &v["choices"][0];
        let msg = &choice["message"];
        let mut text = msg["content"].as_str().unwrap_or_default().to_string();
        let mut tool_calls: Vec<ToolCall> = msg["tool_calls"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
            .filter_map(|(i, c)| {
                let f = &c["function"];
                let args = match &f["arguments"] {
                    Value::String(s) => serde_json::from_str(s).unwrap_or(json!({})),
                    other => other.clone(),
                };
                Some(ToolCall {
                    id: c["id"].as_str().map(String::from).unwrap_or_else(|| format!("call_{i}")),
                    name: f["name"].as_str()?.to_string(),
                    args,
                })
            })
            .collect();
        // Beaucoup de modèles locaux écrivent l'appel dans le texte au lieu de
        // remplir `tool_calls` : on le récupère.
        if tool_calls.is_empty() && !tools.is_empty() {
            let (rest, calls) = text_tools::extract(&text, tools);
            if !calls.is_empty() {
                text = rest;
                tool_calls = calls;
            }
        }
        Ok(Reply { text, tool_calls, raw: None, truncated: choice["finish_reason"] == "length" })
    }
}
