//! Lecture des erreurs de compilation.
//!
//! On ne fait pas de regex fragile quand le compilateur sait parler JSON :
//! cargo (`--message-format=json`) et gcc (`-fdiagnostics-format=json`) sont
//! lus tels quels. Le texte classique `fichier:ligne:col: error: …` (gcc,
//! clang, mypy, ruff…) et les tracebacks Python ont leur propre lecteur.

mod cargo;
mod gcc;
mod python;
mod text;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warning,
    Note,
}

/// Un remplacement proposé par le compilateur lui-même.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Suggestion {
    pub message: String,
    pub file: String,
    pub line_start: u32,
    pub col_start: u32,
    pub line_end: u32,
    pub col_end: u32,
    pub replacement: String,
    /// rustc `MachineApplicable` : sûr à appliquer sans modèle.
    pub machine_applicable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub level: Level,
    pub code: Option<String>,
    pub message: String,
    /// Notes et aides du compilateur, déjà mises en forme.
    pub notes: Vec<String>,
    pub suggestions: Vec<Suggestion>,
}

impl Diagnostic {
    pub fn is_error(&self) -> bool {
        self.level == Level::Error
    }

    /// Résumé court sur une ligne : `E0308 mismatched types (src/config.rs:58:19)`.
    pub fn headline(&self) -> String {
        let code = self.code.as_deref().map(|c| format!("{c} ")).unwrap_or_default();
        format!("{code}{} ({}:{}:{})", self.message, self.file, self.line, self.column)
    }
}

/// Essaie chaque format reconnu et renvoie les diagnostics dédoublonnés.
pub fn parse(output: &str) -> Vec<Diagnostic> {
    let mut found = cargo::parse(output);
    if found.is_empty() {
        found = gcc::parse(output);
    }
    if found.is_empty() {
        found = python::parse(output);
    }
    // Le texte classique complète toujours : un build CMake mélange des
    // sorties de plusieurs outils.
    for d in text::parse(output) {
        if !found.iter().any(|f| f.file == d.file && f.line == d.line && f.message == d.message) {
            found.push(d);
        }
    }
    found.dedup_by(|a, b| a.file == b.file && a.line == b.line && a.message == b.message);
    found
}

pub fn errors(diags: &[Diagnostic]) -> Vec<&Diagnostic> {
    diags.iter().filter(|d| d.is_error()).collect()
}

#[cfg(test)]
mod tests;
