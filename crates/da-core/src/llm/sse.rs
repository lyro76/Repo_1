//! Lecture des réponses en flux (Server-Sent Events), communes aux deux API.

use anyhow::Result;

/// Une callback qui reçoit le texte au fur et à mesure.
pub type OnText<'a> = Option<&'a (dyn Fn(&str) + Send + Sync)>;

/// Lit le flux SSE de `resp` et appelle `on_event(type, data)` pour chaque
/// événement complet. `on_event` renvoie `false` pour arrêter.
pub async fn read(mut resp: reqwest::Response, mut on_event: impl FnMut(&str, &str) -> Result<bool>) -> Result<()> {
    let mut buf: Vec<u8> = Vec::new();
    let mut event = String::new();
    let mut data = String::new();
    while let Some(chunk) = resp.chunk().await? {
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let raw: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&raw);
            let line = line.trim_end_matches(['\n', '\r']);
            if line.is_empty() {
                // Fin d'un événement.
                if !data.is_empty() && !on_event(&event, &data)? {
                    return Ok(());
                }
                event.clear();
                data.clear();
            } else if let Some(v) = line.strip_prefix("event:") {
                event = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(v.strip_prefix(' ').unwrap_or(v));
            }
        }
    }
    if !data.is_empty() {
        on_event(&event, &data)?;
    }
    Ok(())
}

pub fn is_stream(resp: &reqwest::Response) -> bool {
    resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.contains("text/event-stream"))
}
