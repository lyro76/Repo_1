use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::config::Config;
use crate::events::{Event, Host, Stream};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    Rust,
    Cpp,
    Python,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CppBuild {
    CMake,
    Make,
}

#[derive(Debug, Clone)]
pub struct Project {
    pub root: PathBuf,
    pub lang: Lang,
    cpp: Option<CppBuild>,
}

#[derive(Debug, Clone)]
pub struct CmdOutput {
    pub ok: bool,
    pub code: Option<i32>,
    /// stdout + stderr entrelacés, tels que reçus.
    pub output: String,
    pub seconds: f32,
}

impl Project {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root: PathBuf = root.into();
        let root = root.canonicalize().with_context(|| format!("dossier introuvable : {}", root.display()))?;
        let has = |f: &str| root.join(f).exists();
        let (lang, cpp) = if has("Cargo.toml") {
            (Lang::Rust, None)
        } else if has("CMakeLists.txt") {
            (Lang::Cpp, Some(CppBuild::CMake))
        } else if has("pyproject.toml") || has("setup.py") || has("requirements.txt") {
            (Lang::Python, None)
        } else if has("Makefile") && has_ext(&root, &["cpp", "cc", "cxx", "c", "hpp", "h"]) {
            (Lang::Cpp, Some(CppBuild::Make))
        } else if has_ext(&root, &["py"]) {
            (Lang::Python, None)
        } else {
            (Lang::Unknown, None)
        };
        Ok(Self { root, lang, cpp })
    }

    pub fn name(&self) -> String {
        self.root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    }

    /// Commande de build qui produit des diagnostics lisibles par [`crate::diag`].
    pub fn build_command(&self, cfg: &Config) -> Option<String> {
        if let Some(c) = &cfg.build_cmd {
            return Some(c.clone());
        }
        Some(match (self.lang, self.cpp) {
            (Lang::Rust, _) => "cargo build --message-format=json".into(),
            (Lang::Cpp, Some(CppBuild::CMake)) => "cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON && cmake --build build".into(),
            (Lang::Cpp, _) => "make".into(),
            (Lang::Python, _) => format!("{} -m compileall -q -x \"(\\.venv|venv|build|\\.git)\" .", python()),
            (Lang::Unknown, _) => return None,
        })
    }

    pub fn test_command(&self, cfg: &Config) -> Option<String> {
        if let Some(c) = &cfg.test_cmd {
            return Some(c.clone());
        }
        match self.lang {
            Lang::Rust => Some("cargo test --message-format=json".into()),
            Lang::Cpp if self.cpp == Some(CppBuild::CMake) => Some("ctest --test-dir build --output-on-failure".into()),
            Lang::Python if self.root.join("tests").is_dir() || self.root.join("test").is_dir() => Some(if self.root.join("uv.lock").exists() {
                "uv run pytest -x -q".into()
            } else {
                format!("{} -m pytest -x -q", python())
            }),
            _ => None,
        }
    }

    /// Lance une commande shell dans le projet, en recopiant la sortie dans le terminal.
    pub async fn run(&self, cmd: &str, host: &dyn Host, timeout: Duration) -> Result<CmdOutput> {
        host.emit(Event::Terminal { line: format!("{} $ {cmd}", self.prompt_path()), stream: Stream::Agent });
        let start = Instant::now();
        let mut child = shell(cmd)
            .current_dir(&self.root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("impossible de lancer `{cmd}`"))?;

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(Stream, String)>();
        for (pipe, stream) in [
            (child.stdout.take().map(|p| Box::new(p) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), Stream::Stdout),
            (child.stderr.take().map(|p| Box::new(p) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), Stream::Stderr),
        ] {
            let Some(pipe) = pipe else { continue };
            let tx = tx.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(pipe).lines();
                while let Ok(Some(l)) = lines.next_line().await {
                    let _ = tx.send((stream, l));
                }
            });
        }
        drop(tx);

        let mut output = String::new();
        let collect = async {
            while let Some((stream, line)) = rx.recv().await {
                if let Some(shown) = terminal_view(&line) {
                    for l in shown.lines() {
                        host.emit(Event::Terminal { line: l.to_string(), stream });
                    }
                }
                output.push_str(&line);
                output.push('\n');
            }
            child.wait().await
        };
        let status = match tokio::time::timeout(timeout, collect).await {
            Ok(s) => s?,
            Err(_) => bail!("`{cmd}` a dépassé {} s", timeout.as_secs()),
        };
        Ok(CmdOutput { ok: status.success(), code: status.code(), output, seconds: start.elapsed().as_secs_f32() })
    }

    fn prompt_path(&self) -> String {
        format!("~/{}", self.name())
    }
}

/// Ce que le terminal affiche d'une ligne : la sortie JSON de cargo est
/// remplacée par son rendu texte, le reste passe tel quel.
fn terminal_view(line: &str) -> Option<String> {
    if !line.starts_with("{\"reason\"") {
        return Some(line.to_string());
    }
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    match v["reason"].as_str()? {
        "compiler-message" => v["message"]["rendered"].as_str().map(|s| s.trim_end().to_string()),
        "build-finished" => None,
        _ => None,
    }
}

fn shell(cmd: &str) -> Command {
    if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", cmd]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", cmd]);
        c
    }
}

fn python() -> &'static str {
    if cfg!(windows) {
        "python"
    } else {
        "python3"
    }
}

fn has_ext(root: &Path, exts: &[&str]) -> bool {
    ignore::WalkBuilder::new(root).max_depth(Some(3)).build().flatten().any(|e| {
        e.path().extension().and_then(|x| x.to_str()).is_some_and(|x| exts.contains(&x))
    })
}

/// Squelette d'un nouveau projet, sans modèle : c'est déterministe.
pub fn scaffold(parent: &Path, name: &str, lang: Lang) -> Result<PathBuf> {
    if name.is_empty() || name.contains(['/', '\\']) {
        bail!("nom de projet invalide : {name:?}");
    }
    let dir = parent.join(name);
    if dir.exists() {
        bail!("{} existe déjà", dir.display());
    }
    match lang {
        Lang::Rust => {
            let st = std::process::Command::new("cargo").arg("new").arg(&dir).status().context("cargo introuvable")?;
            if !st.success() {
                bail!("cargo new a échoué");
            }
        }
        Lang::Cpp => {
            std::fs::create_dir_all(dir.join("src"))?;
            std::fs::write(
                dir.join("CMakeLists.txt"),
                format!(
                    "cmake_minimum_required(VERSION 3.20)\nproject({name} CXX)\n\nset(CMAKE_CXX_STANDARD 20)\nset(CMAKE_CXX_STANDARD_REQUIRED ON)\nset(CMAKE_EXPORT_COMPILE_COMMANDS ON)\n\nadd_executable({name} src/main.cpp)\ntarget_compile_options({name} PRIVATE $<$<CXX_COMPILER_ID:GNU,Clang>:-Wall -Wextra>)\n"
                ),
            )?;
            std::fs::write(dir.join("src/main.cpp"), "#include <iostream>\n\nint main() {\n    std::cout << \"Hello\\n\";\n    return 0;\n}\n")?;
            std::fs::write(dir.join(".gitignore"), "/build\n")?;
        }
        Lang::Python => {
            let module = name.replace('-', "_");
            std::fs::create_dir_all(dir.join("src").join(&module))?;
            std::fs::create_dir_all(dir.join("tests"))?;
            std::fs::write(
                dir.join("pyproject.toml"),
                format!("[project]\nname = \"{name}\"\nversion = \"0.1.0\"\nrequires-python = \">=3.10\"\ndependencies = []\n\n[tool.pytest.ini_options]\npythonpath = [\"src\"]\n"),
            )?;
            std::fs::write(dir.join("src").join(&module).join("__init__.py"), "")?;
            std::fs::write(dir.join("tests/test_smoke.py"), format!("import {module}\n\n\ndef test_import():\n    assert {module} is not None\n"))?;
            std::fs::write(dir.join(".gitignore"), "__pycache__/\n.venv/\n")?;
        }
        Lang::Unknown => bail!("langage non pris en charge"),
    }
    let project = Project::open(&dir)?;
    let cfg = Config::default();
    crate::memory::Notes::create_default(&dir, &project.build_command(&cfg).unwrap_or_default(), project.test_command(&cfg).as_deref())?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_and_scaffolds() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = scaffold(tmp.path(), "demo-py", Lang::Python).unwrap();
        let p = Project::open(&dir).unwrap();
        assert_eq!(p.lang, Lang::Python);
        assert!(p.test_command(&Config::default()).unwrap().contains("pytest"));
        assert!(dir.join("NOTES.md").exists());

        let dir = scaffold(tmp.path(), "demo-cpp", Lang::Cpp).unwrap();
        assert_eq!(Project::open(&dir).unwrap().lang, Lang::Cpp);
    }

    #[test]
    fn terminal_shows_rendered_cargo_messages() {
        let line = r#"{"reason":"compiler-message","message":{"rendered":"error[E0308]: mismatched types\n"}}"#;
        assert_eq!(terminal_view(line).unwrap(), "error[E0308]: mismatched types");
        assert_eq!(terminal_view(r#"{"reason":"compiler-artifact"}"#), None);
        assert_eq!(terminal_view("   Compiling x").unwrap(), "   Compiling x");
    }
}
