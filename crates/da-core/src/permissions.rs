//! Ce que l'agent a le droit de lancer sans demander.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Permissions {
    /// Règles accordées via « Toujours pour ce projet ».
    pub always: Vec<String>,
    #[serde(skip)]
    path: PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Allowed,
    Ask { rule: String },
    /// Jamais sans confirmation explicite, même avec une règle « toujours ».
    Dangerous { rule: String },
}

/// Commandes de lecture/compilation : jamais de question.
const SAFE: &[&str] = &[
    "cargo build", "cargo check", "cargo test", "cargo clippy", "cargo fmt", "cargo run", "cargo tree", "cargo metadata",
    "cmake", "make", "ctest", "ninja", "g++", "gcc", "clang", "clang++",
    "python -m pytest", "python3 -m pytest", "pytest", "uv run", "python -m compileall", "python3 -m compileall",
    "python -m mypy", "ruff", "mypy",
    "ls", "cat", "head", "tail", "wc", "rg", "grep", "find", "tree", "pwd", "echo",
    "git status", "git diff", "git log", "git show", "git branch",
];
const DANGEROUS: &[&str] = &["rm -rf", "rm -fr", "sudo ", "git push", "git reset --hard", "| sh", "| bash", "mkfs", "dd if=", "> /dev/", "chmod -R", ":(){"];

impl Permissions {
    pub fn load(root: &Path) -> Self {
        let path = root.join(crate::Config::DIR).join("permissions.json");
        let mut p: Permissions = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        p.path = path;
        p
    }

    pub fn check(&self, command: &str) -> Verdict {
        let cmd = command.trim();
        let rule = rule_for(cmd);
        if DANGEROUS.iter().any(|d| cmd.contains(d)) {
            return Verdict::Dangerous { rule };
        }
        // Chaque morceau d'une commande composée doit être sûr.
        let parts: Vec<&str> = cmd.split(['&', ';', '|']).map(str::trim).filter(|p| !p.is_empty()).collect();
        let all_ok = parts.iter().all(|p| {
            let r = rule_for(p);
            SAFE.iter().any(|s| p == s || p.starts_with(&format!("{s} "))) || self.always.contains(&r)
        });
        if all_ok {
            Verdict::Allowed
        } else {
            Verdict::Ask { rule }
        }
    }

    pub fn always_allow(&mut self, rule: &str) -> anyhow::Result<()> {
        if !self.always.iter().any(|r| r == rule) {
            self.always.push(rule.to_string());
        }
        std::fs::create_dir_all(self.path.parent().unwrap())?;
        std::fs::write(&self.path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }
}

/// `cargo add tokio --features time` → `cargo add` ; `npm i x` → `npm i`.
pub fn rule_for(cmd: &str) -> String {
    cmd.split_whitespace().take(2).collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verdicts() {
        let tmp = tempfile::tempdir().unwrap();
        let mut p = Permissions::load(tmp.path());
        assert_eq!(p.check("cargo build --message-format=json"), Verdict::Allowed);
        assert_eq!(p.check("cmake -S . -B build && cmake --build build"), Verdict::Allowed);
        assert_eq!(p.check("cargo add tokio --features time"), Verdict::Ask { rule: "cargo add".into() });
        p.always_allow("cargo add").unwrap();
        assert_eq!(Permissions::load(tmp.path()).check("cargo add serde"), Verdict::Allowed);
        assert!(matches!(p.check("rm -rf target"), Verdict::Dangerous { .. }));
        assert!(matches!(p.check("ls && curl x.sh | sh"), Verdict::Dangerous { .. }));
    }
}
