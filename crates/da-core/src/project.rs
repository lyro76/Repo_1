use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::config::Config;
use crate::events::{Event, Host, Stream};

/// Ce qu'on sait d'un projet sans modèle : son écosystème et ses commandes.
/// Aucune liste fermée : un projet inconnu garde son langage dominant (par
/// extension) et l'agent propose lui-même les commandes au premier build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Kind {
    /// Identifiant court (`rust`, `go`, `typescript`, `lua`…).
    pub id: String,
    /// Nom lisible (`Rust`, `Go`, `TypeScript`…).
    pub name: String,
    /// Étiquette d'onglet (`rs`, `go`, `ts`…).
    pub label: String,
    pub build: Option<String>,
    pub test: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Project {
    pub root: PathBuf,
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
        Ok(Self { root: dunce(root) })
    }

    pub fn name(&self) -> String {
        self.root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    }

    /// Détection à la demande : l'agent peut créer `go.mod` ou `package.json`
    /// en cours de tâche, le projet change alors de nature.
    pub fn kind(&self) -> Kind {
        detect(&self.root)
    }

    /// Commande de build : celle de la config, sinon celle de l'écosystème détecté.
    pub fn build_command(&self, cfg: &Config) -> Option<String> {
        cfg.build_cmd.clone().or_else(|| self.kind().build)
    }

    pub fn test_command(&self, cfg: &Config) -> Option<String> {
        cfg.test_cmd.clone().or_else(|| self.kind().test)
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

/// Sous Windows, `canonicalize` renvoie `\\?\C:\…`, que beaucoup d'outils refusent.
fn dunce(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => p,
    }
}

/// Extension → (identifiant, nom), pour le langage dominant d'un projet sans
/// manifeste reconnu. Ce n'est pas une limite : un projet hors de cette liste
/// reste utilisable, il s'appelle juste « Inconnu » tant que l'agent n'a pas
/// trouvé ses commandes.
const EXTENSIONS: &[(&str, &str, &str)] = &[
    ("rs", "rust", "Rust"), ("go", "go", "Go"), ("py", "python", "Python"), ("ts", "typescript", "TypeScript"),
    ("tsx", "typescript", "TypeScript"), ("js", "javascript", "JavaScript"), ("mjs", "javascript", "JavaScript"),
    ("jsx", "javascript", "JavaScript"), ("c", "c", "C"), ("h", "c", "C"), ("cpp", "cpp", "C++"), ("cc", "cpp", "C++"),
    ("cxx", "cpp", "C++"), ("hpp", "cpp", "C++"), ("cs", "csharp", "C#"), ("fs", "fsharp", "F#"), ("java", "java", "Java"),
    ("kt", "kotlin", "Kotlin"), ("scala", "scala", "Scala"), ("swift", "swift", "Swift"), ("zig", "zig", "Zig"),
    ("dart", "dart", "Dart"), ("ex", "elixir", "Elixir"), ("exs", "elixir", "Elixir"), ("erl", "erlang", "Erlang"),
    ("hs", "haskell", "Haskell"), ("ml", "ocaml", "OCaml"), ("rb", "ruby", "Ruby"), ("php", "php", "PHP"),
    ("lua", "lua", "Lua"), ("jl", "julia", "Julia"), ("r", "r", "R"), ("nim", "nim", "Nim"), ("odin", "odin", "Odin"),
    ("gd", "gdscript", "GDScript"), ("sh", "shell", "Shell"), ("ps1", "powershell", "PowerShell"), ("asm", "asm", "Assembleur"),
    ("f90", "fortran", "Fortran"), ("pas", "pascal", "Pascal"), ("cr", "crystal", "Crystal"), ("clj", "clojure", "Clojure"),
    ("pl", "perl", "Perl"), ("v", "v", "V"), ("sol", "solidity", "Solidity"), ("hx", "haxe", "Haxe"),
];

/// Vrai pour une extension de code source connue (sert à l'index générique).
pub fn is_source_ext(ext: &str) -> bool {
    let ext = ext.to_lowercase();
    EXTENSIONS.iter().any(|(x, _, _)| *x == ext) || matches!(ext.as_str(), "kts" | "mts" | "cts" | "vue" | "svelte" | "groovy" | "m" | "mm")
}

const LABELS: &[(&str, &str)] = &[
    ("rust", "rs"), ("python", "py"), ("typescript", "ts"), ("javascript", "js"), ("csharp", "cs"), ("fsharp", "fs"),
    ("kotlin", "kt"), ("elixir", "ex"), ("haskell", "hs"), ("ocaml", "ml"), ("ruby", "rb"), ("julia", "jl"),
    ("gdscript", "gd"), ("powershell", "ps1"), ("fortran", "f90"), ("clojure", "clj"), ("perl", "pl"), ("inconnu", "?"),
];

fn kind(id: &str, name: &str, build: Option<String>, test: Option<String>) -> Kind {
    let label = LABELS.iter().find(|(i, _)| *i == id).map(|(_, l)| l.to_string()).unwrap_or_else(|| id.chars().take(4).collect());
    Kind { id: id.into(), name: name.into(), label, build, test }
}

fn detect(root: &Path) -> Kind {
    let has = |f: &str| root.join(f).exists();
    let read = |f: &str| std::fs::read_to_string(root.join(f)).unwrap_or_default();
    let s = |x: &str| Some(x.to_string());

    if has("Cargo.toml") {
        return kind("rust", "Rust", s("cargo build --message-format=json"), s("cargo test --message-format=json"));
    }
    if has("go.mod") {
        return kind("go", "Go", s("go build ./... && go vet ./..."), s("go test ./..."));
    }
    if has("deno.json") || has("deno.jsonc") {
        return kind("typescript", "TypeScript (Deno)", s("deno check ."), s("deno test"));
    }
    if has("package.json") {
        let pkg: serde_json::Value = serde_json::from_str(&read("package.json")).unwrap_or_default();
        let pm = if has("pnpm-lock.yaml") {
            "pnpm"
        } else if has("yarn.lock") {
            "yarn"
        } else if has("bun.lockb") || has("bun.lock") {
            "bun"
        } else {
            "npm"
        };
        // Le script de test par défaut de `npm init` échoue toujours : on l'ignore.
        let script = |n: &str| pkg["scripts"][n].as_str().is_some_and(|v| !v.contains("no test specified"));
        let ts = has("tsconfig.json");
        let build = if script("build") {
            Some(format!("{pm} run build"))
        } else if ts {
            s("npx tsc --noEmit")
        } else if script("lint") {
            Some(format!("{pm} run lint"))
        } else {
            None
        };
        let test = script("test").then(|| format!("{pm} test"));
        return if ts { kind("typescript", "TypeScript", build, test) } else { kind("javascript", "JavaScript", build, test) };
    }
    if has_ext_depth(root, &["sln", "csproj", "fsproj", "vbproj"], 3) {
        let (id, name) = if has_ext_depth(root, &["fsproj"], 3) { ("fsharp", "F#") } else { ("csharp", "C#") };
        return kind(id, name, s("dotnet build -nologo -clp:NoSummary"), s("dotnet test -nologo"));
    }
    if has("pom.xml") {
        return kind("java", "Java (Maven)", s("mvn -q -B compile"), s("mvn -q -B test"));
    }
    if has("build.gradle") || has("build.gradle.kts") {
        let g = match (has("gradlew"), cfg!(windows)) {
            (true, true) => "gradlew.bat",
            (true, false) => "./gradlew",
            _ => "gradle",
        };
        let (id, name) =
            if has("build.gradle.kts") || has_ext_depth(root, &["kt"], 5) { ("kotlin", "Kotlin (Gradle)") } else { ("java", "Java (Gradle)") };
        return kind(id, name, Some(format!("{g} build -x test -q")), Some(format!("{g} test -q")));
    }
    if has("build.sbt") {
        return kind("scala", "Scala", s("sbt -batch compile"), s("sbt -batch test"));
    }
    if has("Package.swift") {
        return kind("swift", "Swift", s("swift build"), s("swift test"));
    }
    if has("build.zig") {
        return kind("zig", "Zig", s("zig build"), s("zig build test"));
    }
    if has("pubspec.yaml") {
        return if read("pubspec.yaml").contains("flutter:") {
            kind("dart", "Flutter", s("flutter analyze"), s("flutter test"))
        } else {
            kind("dart", "Dart", s("dart analyze"), s("dart test"))
        };
    }
    if has("mix.exs") {
        return kind("elixir", "Elixir", s("mix compile"), s("mix test"));
    }
    if has("stack.yaml") {
        return kind("haskell", "Haskell", s("stack build"), s("stack test"));
    }
    if has_ext_depth(root, &["cabal"], 1) {
        return kind("haskell", "Haskell", s("cabal build"), s("cabal test"));
    }
    if has("dune-project") {
        return kind("ocaml", "OCaml", s("dune build"), s("dune test"));
    }
    if has("CMakeLists.txt") {
        return kind(
            "cpp",
            "C/C++ (CMake)",
            s("cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON && cmake --build build"),
            s("ctest --test-dir build --output-on-failure"),
        );
    }
    if has("meson.build") {
        return kind("cpp", "C/C++ (Meson)", s("meson setup build --reconfigure && meson compile -C build"), s("meson test -C build"));
    }
    let dom = dominant(root);
    if has("pyproject.toml") || has("setup.py") || has("requirements.txt") || dom.as_ref().is_some_and(|(id, _)| id == "python") {
        let tests = root.join("tests").is_dir() || root.join("test").is_dir();
        let test = tests.then(|| if has("uv.lock") { "uv run pytest -x -q".to_string() } else { format!("{} -m pytest -x -q", python()) });
        return kind("python", "Python", Some(format!("{} -m compileall -q -x \"(\\.venv|venv|build|\\.git)\" .", python())), test);
    }
    if has("Gemfile") {
        let test = if root.join("spec").is_dir() {
            s("bundle exec rspec")
        } else if has("Rakefile") {
            s("bundle exec rake test")
        } else {
            None
        };
        return kind("ruby", "Ruby", None, test);
    }
    if has("composer.json") {
        let test = root.join("vendor/bin/phpunit").exists().then(|| "vendor/bin/phpunit".to_string());
        return kind("php", "PHP", None, test);
    }
    let (id, name) = dom.unwrap_or_else(|| ("inconnu".into(), "Inconnu".into()));
    let build = (has("Makefile") || has("makefile")).then(|| "make".to_string());
    kind(&id, &name, build, None)
}

/// Langage le plus représenté parmi les fichiers source.
fn dominant(root: &Path) -> Option<(String, String)> {
    let mut counts: std::collections::HashMap<(&str, &str), usize> = Default::default();
    for e in ignore::WalkBuilder::new(root).max_depth(Some(4)).build().flatten().take(5000) {
        let Some(ext) = e.path().extension().and_then(|x| x.to_str()).map(str::to_lowercase) else { continue };
        if let Some((_, id, name)) = EXTENSIONS.iter().find(|(x, _, _)| *x == ext) {
            *counts.entry((id, name)).or_default() += 1;
        }
    }
    counts.into_iter().max_by_key(|(_, n)| *n).map(|((id, name), _)| (id.to_string(), name.to_string()))
}

fn has_ext_depth(root: &Path, exts: &[&str], depth: usize) -> bool {
    ignore::WalkBuilder::new(root).max_depth(Some(depth)).build().flatten().any(|e| {
        e.path().extension().and_then(|x| x.to_str()).is_some_and(|x| exts.contains(&x))
    })
}

/// Un nouveau projet. Quelques langages ont un squelette déterministe (rapide,
/// sans modèle) ; pour tous les autres, `bootstrap` contient la demande à
/// confier à l'agent, qui utilisera les outils standard du langage.
pub struct Scaffolded {
    pub dir: PathBuf,
    pub bootstrap: Option<String>,
}

pub fn scaffold(parent: &Path, name: &str, lang: &str) -> Result<Scaffolded> {
    if name.is_empty() || name.contains(['/', '\\']) {
        bail!("nom de projet invalide : {name:?}");
    }
    let lang = lang.trim();
    if lang.is_empty() {
        bail!("précise le langage");
    }
    let dir = parent.join(name);
    if dir.exists() {
        bail!("{} existe déjà", dir.display());
    }
    let mut bootstrap = None;
    match lang.to_lowercase().as_str() {
        "rust" | "rs" => {
            let st = std::process::Command::new("cargo").arg("new").arg(&dir).status().context("cargo introuvable")?;
            if !st.success() {
                bail!("cargo new a échoué");
            }
        }
        "c++" | "cpp" | "cxx" => {
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
        "python" | "py" => {
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
        "go" | "golang" => {
            std::fs::create_dir_all(&dir)?;
            std::fs::write(dir.join("go.mod"), format!("module {name}\n\ngo 1.22\n"))?;
            std::fs::write(dir.join("main.go"), "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"Hello\")\n}\n")?;
        }
        _ => {
            std::fs::create_dir_all(&dir)?;
            bootstrap = Some(format!(
                "Crée le squelette minimal d'un projet {lang} nommé « {name} » dans ce dossier : le manifeste ou fichier de \
                 configuration habituel de cet écosystème, un point d'entrée qui compile et s'exécute, et un premier test. \
                 Utilise les outils standard du langage (tu peux lancer sa commande d'initialisation). Termine en notant \
                 dans NOTES.md, section Commandes, les commandes exactes de build et de test."
            ));
        }
    }
    let project = Project::open(&dir)?;
    let cfg = Config::default();
    let build = project.build_command(&cfg).unwrap_or_else(|| "(à définir)".into());
    crate::memory::Notes::create_default(&dir, &build, project.test_command(&cfg).as_deref())?;
    if bootstrap.is_some() {
        crate::memory::Notes::new(&dir).add("Conventions", &format!("Langage : {lang}"))?;
    }
    Ok(Scaffolded { dir, bootstrap })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(files: &[(&str, &str)]) -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        for (f, content) in files {
            let p = tmp.path().join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, content).unwrap();
        }
        tmp
    }

    fn detect_in(files: &[(&str, &str)]) -> Kind {
        detect(tree(files).path())
    }

    #[test]
    fn detects_many_ecosystems() {
        let k = detect_in(&[("go.mod", "module x"), ("main.go", "")]);
        assert_eq!((k.id.as_str(), k.build.as_deref()), ("go", Some("go build ./... && go vet ./...")));

        let k = detect_in(&[("package.json", r#"{"scripts":{"build":"vite build","test":"vitest"}}"#), ("tsconfig.json", "{}"), ("pnpm-lock.yaml", "")]);
        assert_eq!((k.id.as_str(), k.label.as_str()), ("typescript", "ts"));
        assert_eq!((k.build.as_deref(), k.test.as_deref()), (Some("pnpm run build"), Some("pnpm test")));

        let k = detect_in(&[("package.json", r#"{"scripts":{"test":"echo \"Error: no test specified\" && exit 1"}}"#)]);
        assert_eq!((k.id.as_str(), k.build, k.test), ("javascript", None, None));

        let k = detect_in(&[("src/App/App.csproj", "<Project/>")]);
        assert_eq!((k.name.as_str(), k.label.as_str()), ("C#", "cs"));

        let k = detect_in(&[("build.gradle.kts", "")]);
        assert_eq!(k.id, "kotlin");
    }

    #[test]
    fn unknown_language_is_not_a_dead_end() {
        // Pas de manifeste : le langage dominant, et pas de commande (l'agent la proposera).
        let k = detect_in(&[("main.lua", ""), ("lib/util.lua", ""), ("README.md", "")]);
        assert_eq!((k.id.as_str(), k.name.as_str(), k.build), ("lua", "Lua", None));
        let k = detect_in(&[("prog.xyz", "")]);
        assert_eq!((k.id.as_str(), k.label.as_str()), ("inconnu", "?"));
        // Un Makefile suffit à avoir une commande.
        let k = detect_in(&[("Makefile", "all:"), ("a.odin", "")]);
        assert_eq!((k.id.as_str(), k.build.as_deref()), ("odin", Some("make")));
    }

    #[test]
    fn scaffolds_any_language() {
        let tmp = tempfile::tempdir().unwrap();
        let s = scaffold(tmp.path(), "demo-py", "Python").unwrap();
        assert!(s.bootstrap.is_none());
        let p = Project::open(&s.dir).unwrap();
        assert_eq!(p.kind().id, "python");
        assert!(p.test_command(&Config::default()).unwrap().contains("pytest"));
        assert!(s.dir.join("NOTES.md").exists());

        let s = scaffold(tmp.path(), "demo-go", "go").unwrap();
        assert_eq!(Project::open(&s.dir).unwrap().kind().id, "go");

        // Langage sans squelette intégré : l'agent prend le relais.
        let s = scaffold(tmp.path(), "jeu", "Odin").unwrap();
        assert!(s.bootstrap.as_deref().unwrap().contains("projet Odin"));
        assert!(std::fs::read_to_string(s.dir.join("NOTES.md")).unwrap().contains("Langage : Odin"));
    }

    #[test]
    fn terminal_shows_rendered_cargo_messages() {
        let line = r#"{"reason":"compiler-message","message":{"rendered":"error[E0308]: mismatched types\n"}}"#;
        assert_eq!(terminal_view(line).unwrap(), "error[E0308]: mismatched types");
        assert_eq!(terminal_view(r#"{"reason":"compiler-artifact"}"#), None);
        assert_eq!(terminal_view("   Compiling x").unwrap(), "   Compiling x");
    }
}
