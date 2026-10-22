//! Erreurs d'exécution et échecs de tests, quel que soit le langage :
//! piles d'appels « at … » (JavaScript, Java, Kotlin, C#), panics Rust,
//! échecs `go test`, Ruby, PHP.

use std::sync::LazyLock;

use regex::Regex;

use super::{Diagnostic, Level};

fn re(s: &str) -> Regex {
    Regex::new(s).unwrap()
}

static PANIC: LazyLock<Regex> = LazyLock::new(|| re(r"panicked at (?P<file>[^\s:']+):(?P<line>\d+):(?P<col>\d+):?\s*$"));
static PANIC_OLD: LazyLock<Regex> = LazyLock::new(|| re(r"panicked at '(?P<msg>.*)', (?P<file>[^\s:]+):(?P<line>\d+):(?P<col>\d+)"));
static GO_TEST: LazyLock<Regex> = LazyLock::new(|| re(r"^\s+(?P<file>[\w./\\-]+_test\.go):(?P<line>\d+): (?P<msg>.+)$"));
static EXCEPTION: LazyLock<Regex> = LazyLock::new(|| {
    re(r#"^(?:Uncaught )?(?:Exception in thread "[^"]*" )?(?:Unhandled exception\. )?(?P<code>[A-Za-z_$][\w.$]*(?:Error|Exception))(?::\s*(?P<msg>.*))?$"#)
});
static FRAME: LazyLock<Regex> = LazyLock::new(|| re(r"^\s+at\s+(?P<rest>.+)$"));
static FRAME_JS: LazyLock<Regex> = LazyLock::new(|| re(r"\(?(?P<file>(?:[A-Za-z]:)?[^\s()]+?):(?P<line>\d+):(?P<col>\d+)\)?$"));
static FRAME_JVM: LazyLock<Regex> = LazyLock::new(|| re(r"\((?P<file>[\w$.-]+\.(?:java|kt|kts|scala|groovy|clj)):(?P<line>\d+)\)"));
static FRAME_NET: LazyLock<Regex> = LazyLock::new(|| re(r" in (?P<file>.+?):line (?P<line>\d+)\s*$"));
static RUBY: LazyLock<Regex> =
    LazyLock::new(|| re(r"^(?P<file>[^\s:]+\.rb):(?P<line>\d+):in [`'](?P<func>[^']*)': (?P<msg>.+?)(?: \((?P<code>[\w:]+)\))?$"));
static PHP: LazyLock<Regex> = LazyLock::new(|| {
    re(r"^(?:PHP )?(?P<kind>Parse error|Fatal error|Warning|Uncaught \w+):\s+(?P<msg>.+?) in (?P<file>\S+?\.php)(?: on line |:)(?P<line>\d+)")
});

pub fn parse(output: &str) -> Vec<Diagnostic> {
    let lines: Vec<&str> = output.lines().collect();
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if let Some(c) = PANIC.captures(line) {
            // Le message suit, jusqu'à la trace ou une ligne vide.
            let msg: Vec<&str> = lines[i + 1..]
                .iter()
                .take_while(|l| !l.trim().is_empty() && !l.starts_with("stack backtrace") && !l.starts_with("note:"))
                .take(4)
                .map(|l| l.trim())
                .collect();
            out.push(diag(&c["file"], &c["line"], Some(&c["col"]), "panic", &msg.join(" "), vec![line.trim().to_string()]));
        } else if let Some(c) = PANIC_OLD.captures(line) {
            out.push(diag(&c["file"], &c["line"], Some(&c["col"]), "panic", &c["msg"], vec![]));
        } else if let Some(c) = GO_TEST.captures(line) {
            out.push(diag(&c["file"], &c["line"], None, "test", &c["msg"], vec![]));
        } else if let Some(c) = RUBY.captures(line) {
            let code = c.name("code").map(|m| m.as_str()).unwrap_or("RuntimeError");
            out.push(diag(&c["file"], &c["line"], None, code, &c["msg"], vec![format!("dans {}", &c["func"])]));
        } else if let Some(c) = PHP.captures(line) {
            out.push(diag(&c["file"], &c["line"], None, &c["kind"], &c["msg"], vec![]));
        } else if let Some(c) = EXCEPTION.captures(line.trim_end()) {
            let frames: Vec<&str> = lines[i + 1..].iter().map_while(|l| FRAME.captures(l).map(|f| f.get(1).unwrap().as_str())).collect();
            if frames.is_empty() {
                continue;
            }
            let notes = frames.iter().take(6).map(|f| format!("at {f}")).collect();
            let msg = c.name("msg").map(|m| m.as_str()).filter(|m| !m.is_empty()).unwrap_or(&c["code"]);
            let code = c["code"].rsplit('.').next().unwrap_or(&c["code"]);
            // Première frame qui appartient au projet, pas au runtime.
            let located = frames.iter().filter(|f| !is_runtime(f)).find_map(|f| locate(f));
            let mut d = match located {
                Some((file, line, col)) => diag(&file, &line, col.as_deref(), code, msg, notes),
                None => diag("", "0", None, code, msg, notes),
            };
            if d.file.is_empty() {
                d.line = 0;
            }
            out.push(d);
        }
    }
    out
}

fn locate(frame: &str) -> Option<(String, String, Option<String>)> {
    if let Some(c) = FRAME_NET.captures(frame) {
        return Some((c["file"].to_string(), c["line"].to_string(), None));
    }
    if let Some(c) = FRAME_JVM.captures(frame) {
        return Some((c["file"].to_string(), c["line"].to_string(), None));
    }
    FRAME_JS.captures(frame).map(|c| (c["file"].to_string(), c["line"].to_string(), Some(c["col"].to_string())))
}

fn is_runtime(frame: &str) -> bool {
    ["node:", "node_modules", "(internal/", "<anonymous>)", "java.base/", "jdk.internal", "kotlin.", "System.", "Microsoft."]
        .iter()
        .any(|p| frame.contains(p))
}

fn diag(file: &str, line: &str, col: Option<&str>, code: &str, msg: &str, notes: Vec<String>) -> Diagnostic {
    Diagnostic {
        file: file.to_string(),
        line: line.parse().unwrap_or(0),
        column: col.and_then(|c| c.parse().ok()).unwrap_or(1),
        level: Level::Error,
        code: Some(code.to_string()),
        message: msg.trim().to_string(),
        notes,
        suggestions: Vec::new(),
    }
}
