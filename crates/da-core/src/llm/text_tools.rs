//! Protocole d'outils en texte pour les modèles qui ne gèrent pas le tool
//! calling natif (ou le gèrent mal) : le modèle écrit un bloc
//! ```json {"tool": "read_file", "args": {...}} ```.

use serde_json::Value;

use super::{ToolCall, ToolSpec};

pub fn instructions(tools: &[ToolSpec]) -> String {
    let mut s = String::from(
        "## Outils\nPour utiliser un outil, écris UNIQUEMENT un bloc de code json de la forme :\n```json\n{\"tool\": \"nom\", \"args\": {…}}\n```\nUn seul outil par message. Tu recevras le résultat au message suivant.\n\nOutils disponibles :\n",
    );
    for t in tools {
        s.push_str(&format!("- `{}` : {} Paramètres : {}\n", t.name, t.description, t.schema["properties"]));
    }
    s
}

/// Cherche des appels d'outils dans le texte. Renvoie le texte restant et les appels.
pub fn extract(text: &str, tools: &[ToolSpec]) -> (String, Vec<ToolCall>) {
    let mut calls = Vec::new();
    let mut rest = String::new();
    let mut remaining = text;
    while let Some(start) = remaining.find('{') {
        let Some(len) = balanced(&remaining[start..]) else { break };
        let candidate = &remaining[start..start + len];
        let parsed = serde_json::from_str::<Value>(candidate).ok().and_then(|v| {
            let name = v.get("tool").or_else(|| v.get("name"))?.as_str()?.to_string();
            tools.iter().any(|t| t.name == name).then(|| {
                let args = v.get("args").or_else(|| v.get("arguments")).or_else(|| v.get("parameters")).cloned();
                (name, args.unwrap_or(Value::Object(Default::default())))
            })
        });
        match parsed {
            Some((name, args)) => {
                rest.push_str(&remaining[..start]);
                calls.push(ToolCall { id: format!("txt_{}", calls.len()), name, args });
            }
            None => rest.push_str(&remaining[..start + len]),
        }
        remaining = &remaining[start + len..];
    }
    rest.push_str(remaining);
    let rest = rest.replace("```json", "").replace("```", "").trim().to_string();
    (rest, calls)
}

/// Longueur de l'objet JSON équilibré qui commence en `s[0] == '{'`.
fn balanced(s: &str) -> Option<usize> {
    let (mut depth, mut in_str, mut esc) = (0i32, false, false);
    for (i, c) in s.char_indices() {
        if in_str {
            match (esc, c) {
                (true, _) => esc = false,
                (false, '\\') => esc = true,
                (false, '"') => in_str = false,
                _ => {}
            }
            continue;
        }
        match c {
            '"' => in_str = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn extracts_fenced_call() {
        let tools = [ToolSpec { name: "read_file", description: "", schema: json!({}) }];
        let (rest, calls) = extract("Je lis le fichier.\n```json\n{\"tool\": \"read_file\", \"args\": {\"path\": \"src/a.rs\"}}\n```", &tools);
        assert_eq!(rest, "Je lis le fichier.");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].args["path"], "src/a.rs");
    }

    #[test]
    fn ignores_unknown_json() {
        let tools = [ToolSpec { name: "read_file", description: "", schema: json!({}) }];
        let (rest, calls) = extract("config: {\"a\": 1}", &tools);
        assert!(calls.is_empty());
        assert_eq!(rest, "config: {\"a\": 1}");
    }
}
