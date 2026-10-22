use serde_json::Value;

use super::{Diagnostic, Level, Suggestion};

/// Sortie de `gcc -fdiagnostics-format=json` : un tableau JSON par unité de compilation.
pub fn parse(output: &str) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    for line in output.lines().map(str::trim).filter(|l| l.starts_with("[{")) {
        let Ok(Value::Array(items)) = serde_json::from_str::<Value>(line) else { continue };
        out.extend(items.iter().filter_map(from_item));
    }
    out
}

fn from_item(item: &Value) -> Option<Diagnostic> {
    let level = match item["kind"].as_str()? {
        "error" | "fatal error" => Level::Error,
        "warning" => Level::Warning,
        _ => Level::Note,
    };
    let caret = &item["locations"].as_array()?.first()?["caret"];
    let notes = item["children"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| {
            let msg = c["message"].as_str()?;
            let loc = &c["locations"][0]["caret"];
            Some(match (loc["file"].as_str(), loc["line"].as_u64()) {
                (Some(f), Some(l)) => format!("{}: {msg} ({f}:{l})", c["kind"].as_str().unwrap_or("note")),
                _ => format!("note: {msg}"),
            })
        })
        .collect();
    let suggestions = item["fixits"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| {
            let start = &f["start"];
            let next = &f["next"];
            Some(Suggestion {
                message: "fix-it".into(),
                file: start["file"].as_str()?.to_string(),
                line_start: start["line"].as_u64()? as u32,
                col_start: start["column"].as_u64()? as u32,
                line_end: next["line"].as_u64()? as u32,
                col_end: next["column"].as_u64()? as u32,
                replacement: f["string"].as_str()?.to_string(),
                // gcc ne qualifie pas ses fix-its : on les montre au modèle.
                machine_applicable: false,
            })
        })
        .collect();
    Some(Diagnostic {
        file: caret["file"].as_str()?.to_string(),
        line: caret["line"].as_u64()? as u32,
        column: caret["column"].as_u64().unwrap_or(1) as u32,
        level,
        code: item["option"].as_str().map(str::to_string),
        message: item["message"].as_str()?.to_string(),
        notes,
        suggestions,
    })
}
