use std::sync::LazyLock;

use regex::Regex;

use super::{Diagnostic, Level};

/// `fichier:ligne:col: error: message [-Wflag]` — gcc, clang, mypy, ruff, flake8…
static LOC: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?P<file>[^\s:][^:]*?):(?P<line>\d+):(?:(?P<col>\d+):)?\s*(?P<lvl>fatal error|error|warning|note)\s*:\s*(?P<msg>.+?)(?:\s+\[(?P<code>[^\]]+)\])?\s*$").unwrap()
});

pub fn parse(output: &str) -> Vec<Diagnostic> {
    let mut out: Vec<Diagnostic> = Vec::new();
    for line in output.lines() {
        let Some(c) = LOC.captures(line.trim_end()) else { continue };
        let level = match &c["lvl"] {
            "error" | "fatal error" => Level::Error,
            "warning" => Level::Warning,
            _ => Level::Note,
        };
        // Une note se rattache au diagnostic précédent.
        if level == Level::Note {
            if let Some(prev) = out.last_mut() {
                prev.notes.push(format!("note: {} ({}:{})", &c["msg"], &c["file"], &c["line"]));
            }
            continue;
        }
        out.push(Diagnostic {
            file: c["file"].to_string(),
            line: c["line"].parse().unwrap_or(1),
            column: c.name("col").and_then(|m| m.as_str().parse().ok()).unwrap_or(1),
            level,
            code: c.name("code").map(|m| m.as_str().to_string()),
            message: c["msg"].to_string(),
            notes: Vec::new(),
            suggestions: Vec::new(),
        });
    }
    out
}
