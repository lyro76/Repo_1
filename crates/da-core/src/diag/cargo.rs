use serde_json::Value;

use super::{Diagnostic, Level, Suggestion};

/// Sortie de `cargo build --message-format=json` : un objet JSON par ligne.
pub fn parse(output: &str) -> Vec<Diagnostic> {
    output
        .lines()
        .filter(|l| l.starts_with('{'))
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["reason"] == "compiler-message")
        .filter_map(|v| from_message(&v["message"]))
        .collect()
}

fn from_message(msg: &Value) -> Option<Diagnostic> {
    let level = match msg["level"].as_str()? {
        "error" | "error: internal compiler error" => Level::Error,
        "warning" => Level::Warning,
        _ => Level::Note,
    };
    let spans = msg["spans"].as_array()?;
    // « aborting due to 2 previous errors » n'a pas de span : on l'ignore.
    let primary = spans.iter().find(|s| s["is_primary"] == true).or_else(|| spans.first())?;

    let mut notes = Vec::new();
    if let Some(label) = primary["label"].as_str() {
        notes.push(label.to_string());
    }
    let mut suggestions = Vec::new();
    collect_suggestions(spans, msg["message"].as_str().unwrap_or(""), &mut suggestions);
    for child in msg["children"].as_array().into_iter().flatten() {
        let text = child["message"].as_str().unwrap_or_default();
        let lvl = child["level"].as_str().unwrap_or("note");
        if !text.is_empty() {
            notes.push(format!("{lvl}: {text}"));
        }
        if let Some(child_spans) = child["spans"].as_array() {
            collect_suggestions(child_spans, text, &mut suggestions);
        }
    }

    Some(Diagnostic {
        file: primary["file_name"].as_str()?.to_string(),
        line: primary["line_start"].as_u64()? as u32,
        column: primary["column_start"].as_u64().unwrap_or(1) as u32,
        level,
        code: msg["code"]["code"].as_str().map(str::to_string),
        message: msg["message"].as_str()?.to_string(),
        notes,
        suggestions,
    })
}

fn collect_suggestions(spans: &[Value], message: &str, out: &mut Vec<Suggestion>) {
    for s in spans {
        let Some(replacement) = s["suggested_replacement"].as_str() else { continue };
        let num = |k: &str| s[k].as_u64().unwrap_or(0) as u32;
        out.push(Suggestion {
            message: message.to_string(),
            file: s["file_name"].as_str().unwrap_or_default().to_string(),
            line_start: num("line_start"),
            col_start: num("column_start"),
            line_end: num("line_end"),
            col_end: num("column_end"),
            replacement: replacement.to_string(),
            machine_applicable: s["suggestion_applicability"] == "MachineApplicable",
        });
    }
}
