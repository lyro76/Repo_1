//! Mémoire de projet.
//!
//! - `NOTES.md` : conventions et décisions en texte clair, lu à chaque tâche
//!   et enrichi par l'agent (couche 2).
//! - `.digital-arms/fixes.jsonl` : mémoire épisodique erreur → correctif.
//!   En v1 la recherche est lexicale (code d'erreur + mots du message) ; la v2
//!   ajoutera des embeddings locaux sans changer le format.

use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::diag::Diagnostic;

pub struct Notes {
    path: PathBuf,
}

impl Notes {
    pub const FILE: &'static str = "NOTES.md";

    pub fn new(root: &Path) -> Self {
        Self { path: root.join(Self::FILE) }
    }

    pub fn read(&self) -> String {
        std::fs::read_to_string(&self.path).unwrap_or_default()
    }

    /// Ajoute une ligne `- …` sous un titre `## section` (créé au besoin).
    pub fn add(&self, section: &str, line: &str) -> Result<()> {
        let mut text = self.read();
        let header = format!("## {section}");
        let bullet = format!("- {}", line.trim().trim_start_matches("- "));
        if text.lines().any(|l| l.trim() == bullet) {
            return Ok(());
        }
        match text.find(&header) {
            Some(pos) => {
                let after = pos + header.len();
                let end = text[after..].find("\n## ").map(|i| after + i).unwrap_or(text.len());
                let insert_at = text[..end].trim_end().len();
                text.insert_str(insert_at, &format!("\n{bullet}"));
            }
            None => {
                if !text.is_empty() && !text.ends_with('\n') {
                    text.push('\n');
                }
                text.push_str(&format!("\n{header}\n{bullet}\n"));
            }
        }
        std::fs::write(&self.path, text)?;
        Ok(())
    }

    pub fn create_default(root: &Path, build: &str, test: Option<&str>) -> Result<()> {
        let p = root.join(Self::FILE);
        if p.exists() {
            return Ok(());
        }
        let test = test.map(|t| format!("- Tests : `{t}`\n")).unwrap_or_default();
        std::fs::write(
            p,
            format!(
                "# Notes du projet\n\nLues par l'agent au début de chaque tâche. Garde-les courtes et vraies.\n\n## Commandes\n- Build : `{build}`\n{test}\n## Conventions\n\n## Ne pas toucher\n"
            ),
        )?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixRecord {
    pub code: Option<String>,
    pub message: String,
    pub file: String,
    /// Diff unifié appliqué.
    pub diff: String,
    pub backend: String,
}

pub struct FixMemory {
    path: PathBuf,
}

impl FixMemory {
    pub fn new(root: &Path) -> Self {
        Self { path: root.join(crate::Config::DIR).join("fixes.jsonl") }
    }

    pub fn record(&self, rec: &FixRecord) -> Result<()> {
        std::fs::create_dir_all(self.path.parent().unwrap())?;
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.path)?;
        writeln!(f, "{}", serde_json::to_string(rec)?)?;
        Ok(())
    }

    /// Les correctifs passés les plus proches de cette erreur (au plus `n`).
    pub fn similar(&self, d: &Diagnostic, n: usize) -> Vec<FixRecord> {
        let Ok(text) = std::fs::read_to_string(&self.path) else { return Vec::new() };
        let words = tokens(&d.message);
        let mut scored: Vec<(f32, FixRecord)> = text
            .lines()
            .filter_map(|l| serde_json::from_str::<FixRecord>(l).ok())
            .map(|r| {
                let other = tokens(&r.message);
                let inter = words.iter().filter(|w| other.contains(w)).count() as f32;
                let union = (words.len() + other.len()) as f32 - inter;
                let mut score = if union > 0.0 { inter / union } else { 0.0 };
                if r.code.is_some() && r.code == d.code {
                    score += 0.5;
                }
                (score, r)
            })
            .filter(|(s, _)| *s >= 0.5)
            .collect();
        scored.sort_by(|a, b| b.0.total_cmp(&a.0));
        // Les plus récents d'abord à score égal : on garde l'ordre inverse du fichier.
        scored.into_iter().take(n).map(|(_, r)| r).collect()
    }
}

fn tokens(s: &str) -> Vec<String> {
    let mut v: Vec<String> = s
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|w| w.len() > 2)
        .map(str::to_lowercase)
        .collect();
    v.sort();
    v.dedup();
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diag::Level;

    #[test]
    fn notes_sections() {
        let tmp = tempfile::tempdir().unwrap();
        Notes::create_default(tmp.path(), "cargo build", None).unwrap();
        let n = Notes::new(tmp.path());
        n.add("Conventions", "Pas de unwrap() dans net/").unwrap();
        n.add("Conventions", "Pas de unwrap() dans net/").unwrap();
        n.add("Décisions", "tokio pour l'async").unwrap();
        let t = n.read();
        assert_eq!(t.matches("Pas de unwrap").count(), 1);
        assert!(t.contains("## Conventions\n- Pas de unwrap() dans net/\n"));
        assert!(t.contains("## Décisions\n- tokio"));
    }

    #[test]
    fn similar_fixes() {
        let tmp = tempfile::tempdir().unwrap();
        let m = FixMemory::new(tmp.path());
        m.record(&FixRecord { code: Some("E0308".into()), message: "mismatched types".into(), file: "a.rs".into(), diff: "-a\n+b".into(), backend: "local".into() }).unwrap();
        m.record(&FixRecord { code: Some("E0425".into()), message: "cannot find value `x`".into(), file: "b.rs".into(), diff: "".into(), backend: "local".into() }).unwrap();
        let d = Diagnostic { file: "c.rs".into(), line: 1, column: 1, level: Level::Error, code: Some("E0308".into()), message: "mismatched types".into(), notes: vec![], suggestions: vec![] };
        let s = m.similar(&d, 3);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].file, "a.rs");
    }
}
