use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use super::sse::{self, OnText};
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

    pub async fn chat(&self, system: &str, msgs: &[Msg], tools: &[ToolSpec], on_text: OnText<'_>) -> Result<Reply> {
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
            "stream": true,
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
        if !status.is_success() {
            let v: Value = resp.json().await.unwrap_or_default();
            bail!("serveur local {status}: {}", v["error"]["message"].as_str().unwrap_or(&v.to_string()));
        }
        let mut acc = Accumulator::default();
        if sse::is_stream(&resp) {
            sse::read(resp, |_, data| {
                if data.trim() == "[DONE]" {
                    return Ok(false);
                }
                let v: Value = serde_json::from_str(data).context("morceau de flux illisible")?;
                if let Some(e) = v["error"]["message"].as_str() {
                    bail!("serveur local : {e}");
                }
                if let Some(t) = acc.push(&v) {
                    if let Some(cb) = on_text {
                        cb(t);
                    }
                }
                Ok(true)
            })
            .await?;
        } else {
            // Serveur qui ignore `stream` : une seule réponse complète.
            let v: Value = resp.json().await.context("réponse non JSON du serveur local")?;
            acc.whole(&v);
        }
        let (mut text, mut tool_calls, finish) = acc.finish();
        // Beaucoup de modèles locaux écrivent l'appel dans le texte au lieu de
        // remplir `tool_calls` : on le récupère.
        if tool_calls.is_empty() && !tools.is_empty() {
            let (rest, calls) = text_tools::extract(&text, tools);
            if !calls.is_empty() {
                text = rest;
                tool_calls = calls;
            }
        }
        Ok(Reply { text, tool_calls, raw: None, truncated: finish == "length" })
    }
}

/// Reconstitue une réponse à partir des morceaux `chat.completion.chunk`.
#[derive(Default)]
struct Accumulator {
    text: String,
    /// Par index : (id, nom, arguments JSON en texte).
    calls: Vec<(String, String, String)>,
    finish: String,
}

impl Accumulator {
    /// Ajoute un morceau ; renvoie le texte nouveau, s'il y en a.
    fn push<'v>(&mut self, chunk: &'v Value) -> Option<&'v str> {
        let choice = &chunk["choices"][0];
        if let Some(f) = choice["finish_reason"].as_str() {
            self.finish = f.to_string();
        }
        let delta = &choice["delta"];
        for c in delta["tool_calls"].as_array().into_iter().flatten() {
            let i = c["index"].as_u64().unwrap_or(self.calls.len() as u64) as usize;
            while self.calls.len() <= i {
                self.calls.push(Default::default());
            }
            let slot = &mut self.calls[i];
            if let Some(id) = c["id"].as_str() {
                slot.0 = id.to_string();
            }
            if let Some(n) = c["function"]["name"].as_str() {
                slot.1.push_str(n);
            }
            match &c["function"]["arguments"] {
                Value::String(a) => slot.2.push_str(a),
                Value::Null => {}
                other => slot.2.push_str(&other.to_string()),
            }
        }
        let t = delta["content"].as_str().filter(|t| !t.is_empty())?;
        self.text.push_str(t);
        Some(t)
    }

    /// Réponse non streamée (`chat.completion`).
    fn whole(&mut self, v: &Value) {
        let choice = &v["choices"][0];
        self.finish = choice["finish_reason"].as_str().unwrap_or_default().to_string();
        self.text = choice["message"]["content"].as_str().unwrap_or_default().to_string();
        for c in choice["message"]["tool_calls"].as_array().into_iter().flatten() {
            let args = match &c["function"]["arguments"] {
                Value::String(a) => a.clone(),
                other => other.to_string(),
            };
            self.calls.push((c["id"].as_str().unwrap_or_default().into(), c["function"]["name"].as_str().unwrap_or_default().into(), args));
        }
    }

    fn finish(self) -> (String, Vec<ToolCall>, String) {
        let calls = self
            .calls
            .into_iter()
            .enumerate()
            .filter(|(_, (_, name, _))| !name.is_empty())
            .map(|(i, (id, name, args))| ToolCall {
                id: if id.is_empty() { format!("call_{i}") } else { id },
                name,
                args: serde_json::from_str(&args).unwrap_or(json!({})),
            })
            .collect();
        (self.text, calls, self.finish)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rebuilds_streamed_text_and_tool_calls() {
        let chunks = [
            json!({"choices": [{"delta": {"role": "assistant", "content": "Je "}}]}),
            json!({"choices": [{"delta": {"content": "lis."}}]}),
            json!({"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c1", "type": "function", "function": {"name": "read_file", "arguments": "{\"pa"}}]}}]}),
            json!({"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "th\": \"a.rs\"}"}}]}}]}),
            json!({"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}),
        ];
        let mut acc = Accumulator::default();
        let shown: Vec<String> = chunks.iter().filter_map(|c| acc.push(c).map(String::from)).collect();
        assert_eq!(shown, ["Je ", "lis."]);
        let (text, calls, finish) = acc.finish();
        assert_eq!((text.as_str(), finish.as_str()), ("Je lis.", "tool_calls"));
        assert_eq!((calls[0].id.as_str(), calls[0].name.as_str()), ("c1", "read_file"));
        assert_eq!(calls[0].args["path"], "a.rs");
    }
}
