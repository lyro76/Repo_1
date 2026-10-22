use std::sync::LazyLock;

use regex::Regex;

use super::{Diagnostic, Level};

/// `fichier:ligne:col: error: message [-Wflag]` — gcc, clang, javac, mypy, ruff, swiftc, zig…
static LOC: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?P<file>[^\s:][^:]*?):(?P<line>\d+):(?:(?P<col>\d+):)?\s*(?P<lvl>fatal error|error|warning|note)\s*:\s*(?P<msg>.+?)(?:\s+\[(?P<code>[^\]]+)\])?\s*$").unwrap()
});
/// `fichier(ligne,col): error CODE: message` — tsc, MSBuild (C#, F#, VB, C++ MSVC).
static PAREN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?P<file>[^\s(][^(]*?)\((?P<line>\d+),(?P<col>\d+)(?:,\d+,\d+)?\)\s*:\s*(?P<lvl>fatal error|error|warning|note)\s*(?P<code>[A-Z]+\d+)?\s*:\s*(?P<msg>.+?)(?:\s+\[[^\]]+\])?\s*$").unwrap()
});
/// `fichier:ligne:col - error TS2322: message` — tsc en mode « pretty ».
static DASH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?P<file>\S+):(?P<line>\d+):(?P<col>\d+) - (?P<lvl>error|warning) (?P<code>\w+\d+): (?P<msg>.+)$").unwrap()
});
/// `fichier.ext:ligne:col: message` sans niveau — Go, eslint (unix), nim…
static BARE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?P<file>\.?[\w./\\-]+\.[A-Za-z][A-Za-z0-9]{0,5}):(?P<line>\d+):(?P<col>\d+): (?P<msg>.+)$").unwrap());

pub fn parse(output: &str) -> Vec<Diagnostic> {
    let mut out: Vec<Diagnostic> = Vec::new();
    for line in output.lines() {
        let line = line.trim_end();
        let Some(c) = LOC.captures(line).or_else(|| PAREN.captures(line)).or_else(|| DASH.captures(line)) else {
            if let Some(c) = BARE.captures(line) {
                out.push(Diagnostic {
                    file: c["file"].to_string(),
                    line: c["line"].parse().unwrap_or(1),
                    column: c["col"].parse().unwrap_or(1),
                    level: Level::Error,
                    code: None,
                    message: c["msg"].to_string(),
                    notes: Vec::new(),
                    suggestions: Vec::new(),
                });
            }
            continue;
        };
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
