//! Lecture des erreurs de compilation, d'exécution et de tests, pour
//! n'importe quel langage.
//!
//! On ne fait pas de regex fragile quand le compilateur sait parler JSON :
//! cargo (`--message-format=json`) et gcc (`-fdiagnostics-format=json`) sont
//! lus tels quels. Ensuite viennent les formats texte répandus
//! (`fichier:ligne:col: error:`, `fichier(ligne,col): error`, Go…), les
//! tracebacks Python et les piles d'appels (JS, JVM, .NET, Ruby, PHP, panics
//! Rust). Ce qui reste illisible est rattrapé par [`mentions`] : tout chemin
//! de fichier du projet cité dans la sortie.

mod cargo;
mod gcc;
mod python;
mod stack;
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

/// Essaie tous les formats reconnus (une sortie de build mélange souvent
/// plusieurs outils) et renvoie les diagnostics dédoublonnés.
pub fn parse(output: &str) -> Vec<Diagnostic> {
    let mut found: Vec<Diagnostic> = Vec::new();
    let all = [cargo::parse(output), gcc::parse(output), python::parse(output), stack::parse(output), text::parse(output)];
    for d in all.into_iter().flatten() {
        if !found.iter().any(|f| f.file == d.file && f.line == d.line && f.message == d.message) {
            found.push(d);
        }
    }
    found
}

/// Chemins `fichier:ligne` (ou `fichier(ligne` / `fichier on line N`) cités
/// dans une sortie, quel que soit l'outil. Sert de filet quand aucun format
/// n'est reconnu : on sait au moins quels fichiers montrer au modèle.
pub fn mentions(output: &str) -> Vec<(String, u32)> {
    static RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r#"(?P<file>(?:[A-Za-z]:)?[\w./\\-]*[\w-]\.[A-Za-z][A-Za-z0-9]{0,5})(?::| on line |\(|", line )(?P<line>\d+)"#).unwrap()
    });
    let mut out: Vec<(String, u32)> = Vec::new();
    for c in RE.captures_iter(output) {
        let item = (c["file"].to_string(), c["line"].parse().unwrap_or(0));
        if !out.contains(&item) {
            out.push(item);
        }
    }
    out
}

pub fn errors(diags: &[Diagnostic]) -> Vec<&Diagnostic> {
    diags.iter().filter(|d| d.is_error()).collect()
}

#[cfg(test)]
mod tests;
