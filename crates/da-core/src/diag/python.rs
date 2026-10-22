use std::sync::LazyLock;

use regex::Regex;

use super::{Diagnostic, Level};

static FRAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"^\s*File "([^"]+)", line (\d+)(?:, in (.+))?$"#).unwrap());
static EXC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([A-Za-z_][\w.]*(?:Error|Exception|Exit|Interrupt|Warning)|AssertionError)(?::\s?(.*))?$").unwrap());
/// pytest : `tests/test_x.py:12: AssertionError`
static PYTEST_LOC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\S+\.py):(\d+): (\w+)$").unwrap());

/// Tracebacks Python (exécution, SyntaxError) et blocs d'échec pytest.
pub fn parse(output: &str) -> Vec<Diagnostic> {
    let lines: Vec<&str> = output.lines().collect();
    let mut out = Vec::new();
    let mut frames: Vec<(String, u32, Option<String>)> = Vec::new();
    let mut pytest_msg: Vec<String> = Vec::new();

    for line in &lines {
        if let Some(c) = FRAME.captures(line) {
            frames.push((c[1].to_string(), c[2].parse().unwrap_or(1), c.get(3).map(|m| m.as_str().to_string())));
            continue;
        }
        if let Some(rest) = line.strip_prefix("E ") {
            pytest_msg.push(rest.trim().to_string());
            continue;
        }
        if let Some(c) = PYTEST_LOC.captures(line) {
            out.push(Diagnostic {
                file: c[1].to_string(),
                line: c[2].parse().unwrap_or(1),
                column: 1,
                level: Level::Error,
                code: Some(c[3].to_string()),
                message: if pytest_msg.is_empty() { c[3].to_string() } else { pytest_msg.join(" ") },
                notes: Vec::new(),
                suggestions: Vec::new(),
            });
            pytest_msg.clear();
            continue;
        }
        if let (Some(c), false) = (EXC.captures(line.trim_end()), frames.is_empty()) {
            if line.starts_with(' ') {
                continue;
            }
            // Dernière frame qui appartient au projet, pas à la bibliothèque standard.
            let frame = frames
                .iter()
                .rev()
                .find(|(f, _, _)| !is_library(f))
                .or_else(|| frames.last())
                .cloned()
                .unwrap();
            let mut notes: Vec<String> = frames
                .iter()
                .map(|(f, l, func)| format!("at {f}:{l}{}", func.as_ref().map(|n| format!(" in {n}")).unwrap_or_default()))
                .collect();
            notes.reverse();
            out.push(Diagnostic {
                file: frame.0,
                line: frame.1,
                column: 1,
                level: Level::Error,
                code: Some(c[1].to_string()),
                message: c.get(2).map(|m| m.as_str().to_string()).filter(|m| !m.is_empty()).unwrap_or_else(|| c[1].to_string()),
                notes,
                suggestions: Vec::new(),
            });
            frames.clear();
        }
    }
    out
}

fn is_library(file: &str) -> bool {
    file.starts_with('<') || file.contains("site-packages") || file.contains("/lib/python") || file.contains("\\Lib\\")
}
