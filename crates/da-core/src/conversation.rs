//! Mémoire de la conversation, par projet.
//!
//! Entre deux demandes, l'agent ne garde qu'un résumé de chaque échange
//! (demande, réponse finale, fichiers modifiés) : un modèle local de 16k ne
//! peut pas relire tout le détail des appels d'outils précédents.
//!
//! Fichiers, dans `.digital-arms/conversations/` :
//! - `current.json` : la conversation en cours (moteur) ;
//! - `current.feed.json` : le fil affiché par l'interface (opaque ici) ;
//! - `<id>.json` / `<id>.feed.json` : conversations archivées.

use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::llm::Msg;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Turn {
    pub prompt: String,
    /// Dernière réponse de l'agent pour cette demande.
    pub summary: String,
    /// Fichiers créés ou modifiés.
    #[serde(default)]
    pub files: Vec<String>,
    /// Résultat du build final, s'il y en a eu un.
    #[serde(default)]
    pub ok: Option<bool>,
    pub at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub started: u64,
    pub turns: Vec<Turn>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConversationInfo {
    pub id: String,
    pub title: String,
    pub started: u64,
    pub turns: usize,
}

const CURRENT: &str = "current";

fn dir(root: &Path) -> PathBuf {
    root.join(crate::Config::DIR).join("conversations")
}

fn path(root: &Path, name: &str, feed: bool) -> PathBuf {
    dir(root).join(if feed { format!("{name}.feed.json") } else { format!("{name}.json") })
}

pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id != CURRENT && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

impl Conversation {
    fn fresh() -> Self {
        let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        Self { id: format!("{}-{:03}", d.as_secs(), d.subsec_millis()), started: d.as_secs(), turns: Vec::new() }
    }

    /// La conversation en cours du projet (vide s'il n'y en a pas).
    pub fn current(root: &Path) -> Self {
        std::fs::read_to_string(path(root, CURRENT, false))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_else(Self::fresh)
    }

    pub fn save_current(&self, root: &Path) -> Result<()> {
        std::fs::create_dir_all(dir(root))?;
        std::fs::write(path(root, CURRENT, false), serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn title(&self) -> String {
        let first = self.turns.first().map(|t| t.prompt.trim()).unwrap_or("(vide)");
        let line = first.lines().next().unwrap_or(first);
        let mut title: String = line.chars().take(70).collect();
        if line.chars().count() > 70 {
            title.push('…');
        }
        title
    }

    /// L'historique à donner au modèle : les échanges les plus récents qui
    /// tiennent dans `budget` caractères, dans l'ordre chronologique.
    pub fn history(&self, budget: usize) -> Vec<Msg> {
        let mut used = 0;
        let mut kept: Vec<&Turn> = Vec::new();
        for t in self.turns.iter().rev() {
            let size = t.prompt.len() + t.summary.len() + t.files.iter().map(|f| f.len() + 2).sum::<usize>() + 80;
            if used + size > budget {
                break;
            }
            used += size;
            kept.push(t);
        }
        kept.reverse();
        let mut msgs = Vec::new();
        for t in kept {
            msgs.push(Msg::User(t.prompt.clone()));
            let mut text = if t.summary.trim().is_empty() { "(pas de réponse)".to_string() } else { t.summary.trim().to_string() };
            if !t.files.is_empty() {
                text.push_str(&format!("\n\n[Fichiers modifiés : {}]", t.files.join(", ")));
            }
            match t.ok {
                Some(true) => text.push_str("\n[Build : OK]"),
                Some(false) => text.push_str("\n[Build : en échec à la fin]"),
                None => {}
            }
            msgs.push(Msg::Assistant { text, tool_calls: Vec::new(), raw: None });
        }
        msgs
    }

    /// Ajoute un échange à la conversation en cours et l'enregistre.
    pub fn record(root: &Path, turn: Turn) -> Result<()> {
        let mut c = Self::current(root);
        c.turns.push(turn);
        c.save_current(root)
    }

    /// Range la conversation en cours dans les archives (si elle n'est pas vide)
    /// et repart de zéro.
    pub fn archive_current(root: &Path) -> Result<()> {
        let c = Self::current(root);
        let (cur, feed) = (path(root, CURRENT, false), path(root, CURRENT, true));
        if c.turns.is_empty() {
            let _ = std::fs::remove_file(&cur);
            let _ = std::fs::remove_file(&feed);
            return Ok(());
        }
        let base = if valid_id(&c.id) { c.id.clone() } else { format!("{}", c.started) };
        // Jamais d'écrasement d'une archive existante.
        let mut id = base.clone();
        let mut n = 2;
        while path(root, &id, false).exists() {
            id = format!("{base}-{n}");
            n += 1;
        }
        std::fs::rename(&cur, path(root, &id, false))?;
        if feed.exists() {
            std::fs::rename(&feed, path(root, &id, true))?;
        }
        Ok(())
    }

    /// Reprend une conversation archivée (la conversation en cours est archivée).
    pub fn restore(root: &Path, id: &str) -> Result<()> {
        if !valid_id(id) || !path(root, id, false).exists() {
            bail!("conversation introuvable : {id}");
        }
        Self::archive_current(root)?;
        std::fs::rename(path(root, id, false), path(root, CURRENT, false))?;
        let feed = path(root, id, true);
        if feed.exists() {
            std::fs::rename(feed, path(root, CURRENT, true))?;
        }
        Ok(())
    }

    /// Conversations archivées, les plus récentes d'abord.
    pub fn list(root: &Path) -> Vec<ConversationInfo> {
        let Ok(entries) = std::fs::read_dir(dir(root)) else { return Vec::new() };
        let mut out: Vec<ConversationInfo> = entries
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                let id = name.strip_suffix(".json").filter(|n| !n.ends_with(".feed") && *n != CURRENT)?.to_string();
                let c: Conversation = serde_json::from_str(&std::fs::read_to_string(e.path()).ok()?).ok()?;
                Some(ConversationInfo { id, title: c.title(), started: c.started, turns: c.turns.len() })
            })
            .collect();
        out.sort_by_key(|c| std::cmp::Reverse(c.started));
        out
    }

    /// Fil affiché par l'interface, tel qu'elle l'a enregistré.
    pub fn read_feed(root: &Path) -> serde_json::Value {
        std::fs::read_to_string(path(root, CURRENT, true)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    pub fn write_feed(root: &Path, feed: &serde_json::Value) -> Result<()> {
        std::fs::create_dir_all(dir(root))?;
        std::fs::write(path(root, CURRENT, true), serde_json::to_string(feed)?)?;
        Ok(())
    }
}

/// Estimation grossière (≈ 3,5 caractères par token pour du code).
pub fn tokens(chars: usize) -> usize {
    chars * 2 / 7
}

fn msg_len(m: &Msg) -> usize {
    match m {
        Msg::User(t) => t.len(),
        Msg::Assistant { text, tool_calls, .. } => text.len() + tool_calls.iter().map(|c| c.args.to_string().len() + 20).sum::<usize>(),
        Msg::ToolResult { content, .. } => content.len() + 20,
    }
}

const TRIMMED: &str = "[ancien résultat retiré pour libérer de la place ; relance l'outil si tu en as encore besoin]";

/// Fait tenir la conversation dans le contexte d'un modèle local : les plus
/// vieux résultats d'outils sont remplacés par une mention, les 6 derniers
/// messages restent intacts. Renvoie le nombre de résultats retirés.
pub fn fit(msgs: &mut [Msg], fixed_chars: usize, context_tokens: usize) -> usize {
    // On garde un quart du contexte pour la réponse du modèle.
    let budget = context_tokens * 3 / 4;
    let mut total = fixed_chars + msgs.iter().map(msg_len).sum::<usize>();
    let protected = msgs.len().saturating_sub(6);
    let mut trimmed = 0;
    for m in msgs[..protected].iter_mut() {
        if tokens(total) <= budget {
            break;
        }
        if let Msg::ToolResult { content, .. } = m {
            if content.len() > TRIMMED.len() {
                total -= content.len() - TRIMMED.len();
                *content = TRIMMED.to_string();
                trimmed += 1;
            }
        }
    }
    trimmed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(p: &str) -> Turn {
        Turn { prompt: p.into(), summary: format!("fait : {p}"), files: vec!["src/a.rs".into()], ok: Some(true), at: 0 }
    }

    #[test]
    fn history_keeps_recent_turns_within_budget() {
        let c = Conversation { id: "1".into(), started: 1, turns: vec![turn("un"), turn("deux"), turn("trois")] };
        let all = c.history(10_000);
        assert_eq!(all.len(), 6);
        assert!(matches!(&all[0], Msg::User(p) if p == "un"));
        assert!(matches!(&all[1], Msg::Assistant { text, .. } if text.contains("[Fichiers modifiés : src/a.rs]") && text.contains("Build : OK")));
        let recent = c.history(150);
        assert!(matches!(&recent[0], Msg::User(p) if p == "trois"), "seul le plus récent tient");
    }

    #[test]
    fn archive_and_restore() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        Conversation::record(root, turn("ajoute un timeout")).unwrap();
        Conversation::write_feed(root, &serde_json::json!([{"kind": "user", "text": "ajoute un timeout"}])).unwrap();
        let first = Conversation::current(root).id;

        Conversation::archive_current(root).unwrap();
        assert!(Conversation::current(root).turns.is_empty());
        assert!(Conversation::read_feed(root).is_null());
        let list = Conversation::list(root);
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].title.as_str(), list[0].turns), ("ajoute un timeout", 1));

        Conversation::record(root, turn("autre chose")).unwrap();
        Conversation::restore(root, &first).unwrap();
        assert_eq!(Conversation::current(root).turns[0].prompt, "ajoute un timeout");
        assert_eq!(Conversation::read_feed(root)[0]["text"], "ajoute un timeout");
        assert_eq!(Conversation::list(root)[0].title, "autre chose", "la conversation remplacée est archivée");
        assert!(Conversation::restore(root, "../x").is_err());
    }

    #[test]
    fn fit_trims_oldest_tool_results_first() {
        let big = "x".repeat(20_000);
        let mut msgs = vec![Msg::User("go".into())];
        for i in 0..6 {
            msgs.push(Msg::ToolResult { id: format!("{i}"), name: "read_file".into(), content: big.clone(), is_error: false });
        }
        msgs.push(Msg::User("suite".into()));
        // 6 × 20 000 caractères ≈ 34k tokens : trop pour 16k.
        let n = fit(&mut msgs, 2_000, 16_384);
        assert!(n >= 1);
        assert!(matches!(&msgs[1], Msg::ToolResult { content, .. } if content == TRIMMED));
        // Les 6 derniers messages ne sont jamais touchés.
        assert!(msgs[msgs.len() - 6..].iter().all(|m| !matches!(m, Msg::ToolResult { content, .. } if content == TRIMMED)));
    }
}
