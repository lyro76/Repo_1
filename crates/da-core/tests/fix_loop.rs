//! Boucle de correction de bout en bout : un vrai projet cargo cassé, un faux
//! serveur compatible OpenAI qui répond par un bloc SEARCH/REPLACE.

use std::sync::{Arc, Mutex};

use da_core::config::Mode;
use da_core::events::{ApprovalRequest, Decision, Event, Host};
use da_core::{Agent, Config, Project};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

const BROKEN: &str = "use std::time::Duration;

struct Config {
    timeout: u32,
}

fn main() {
    let raw = Duration::from_secs(3);
    let c = Config { timeout: raw };
    println!(\"{}\", c.timeout);
}
";

const MODEL_REPLY: &str = "Le champ attend un u32, on convertit la Duration.\n\nsrc/main.rs\n<<<<<<< SEARCH\n    let c = Config { timeout: raw };\n=======\n    let c = Config { timeout: raw.as_secs() as u32 };\n>>>>>>> REPLACE\n";

/// Serveur HTTP minimal : renvoie toujours la même complétion et garde les requêtes.
async fn fake_llm(reply: &'static str) -> (String, Arc<Mutex<Vec<String>>>) {
    fake_llm_seq(vec![serde_json::json!({"role": "assistant", "content": reply})]).await
}

/// Variante qui déroule une suite de messages assistant (le dernier se répète).
async fn fake_llm_seq(replies: Vec<serde_json::Value>) -> (String, Arc<Mutex<Vec<String>>>) {
    let replies = Arc::new(replies);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = listener.accept().await.unwrap();
            let log = log.clone();
            let replies = replies.clone();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 8192];
                loop {
                    let n = sock.read(&mut chunk).await.unwrap();
                    if n == 0 {
                        return;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    let Some(head_end) = text.find("\r\n\r\n") else { continue };
                    let len: usize = text[..head_end]
                        .lines()
                        .find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap()))
                        .unwrap_or(0);
                    if buf.len() >= head_end + 4 + len {
                        log.lock().unwrap().push(text[head_end + 4..].to_string());
                        break;
                    }
                }
                let n = log.lock().unwrap().len() - 1;
                let msg = &replies[n.min(replies.len() - 1)];
                let body = serde_json::json!({"choices": [{"message": msg, "finish_reason": "stop"}]}).to_string();
                let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                sock.write_all(resp.as_bytes()).await.unwrap();
            });
        }
    });
    (url, seen)
}

fn local_config(url: String) -> Config {
    let mut cfg = Config { mode: Mode::Local, ..Config::default() };
    cfg.local.base_url = url;
    cfg
}

#[derive(Default)]
struct Recorder(Mutex<Vec<Event>>, Mutex<Vec<ApprovalRequest>>, bool);

impl Recorder {
    /// Hôte qui accepte toutes les demandes.
    fn allowing() -> Self {
        Self(Mutex::default(), Mutex::default(), true)
    }
}

impl Host for Recorder {
    fn emit(&self, e: Event) {
        self.0.lock().unwrap().push(e);
    }
    fn approve(&self, r: ApprovalRequest) -> oneshot::Receiver<Decision> {
        self.1.lock().unwrap().push(r);
        let (tx, rx) = oneshot::channel();
        let _ = tx.send(if self.2 { Decision::Allow } else { Decision::Deny });
        rx
    }
}

#[tokio::test]
async fn local_model_fixes_type_error() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("moteur");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("Cargo.toml"), "[package]\nname = \"moteur\"\nversion = \"0.1.0\"\nedition = \"2021\"\n").unwrap();
    std::fs::write(dir.join("src/main.rs"), BROKEN).unwrap();

    let (url, requests) = fake_llm(MODEL_REPLY).await;
    let cfg = local_config(url);
    let host = Arc::new(Recorder::default());
    let agent = Agent::new(Project::open(&dir).unwrap(), cfg, host.clone());

    let out = agent.fix().await.unwrap();
    assert!(out.ok, "build toujours cassé : {:?}", out.remaining);
    assert_eq!(out.attempts, 1);
    assert!(std::fs::read_to_string(dir.join("src/main.rs")).unwrap().contains("raw.as_secs() as u32"));

    // Le modèle a bien reçu l'erreur parsée et le fichier.
    let req = requests.lock().unwrap()[0].clone();
    assert!(req.contains("E0308"), "{req}");
    assert!(req.contains("let c = Config { timeout: raw };"));

    // L'interface a vu l'erreur, le correctif et le build vert.
    let events = host.0.lock().unwrap();
    assert!(events.iter().any(|e| matches!(e, Event::Diagnostics { items } if items[0].code.as_deref() == Some("E0308"))));
    let snapshot = events.iter().find_map(|e| match e { Event::Patch { snapshot, .. } => Some(snapshot.clone()), _ => None }).unwrap();
    assert!(events.iter().any(|e| matches!(e, Event::Build { ok: true, .. })));
    drop(events);

    // La mémoire épisodique a retenu le correctif.
    let fixes = std::fs::read_to_string(dir.join(".digital-arms/fixes.jsonl")).unwrap();
    assert!(fixes.contains("E0308"));

    // « Annuler ce correctif » remet le fichier d'origine.
    agent.undo(&snapshot).unwrap();
    assert_eq!(std::fs::read_to_string(dir.join("src/main.rs")).unwrap(), BROKEN);
}

#[tokio::test]
async fn gives_up_after_max_attempts_without_api() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("p");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("Cargo.toml"), "[package]\nname = \"p\"\nversion = \"0.1.0\"\nedition = \"2021\"\n").unwrap();
    std::fs::write(dir.join("src/main.rs"), BROKEN).unwrap();

    // Un modèle qui ne produit jamais de bloc exploitable.
    let (url, requests) = fake_llm("Je ne sais pas.").await;
    let cfg = local_config(url);
    let agent = Agent::new(Project::open(&dir).unwrap(), cfg, Arc::new(Recorder::default()));

    let out = agent.fix().await.unwrap();
    assert!(!out.ok);
    assert_eq!(out.attempts, 3);
    assert_eq!(requests.lock().unwrap().len(), 3);
    // Le 2e appel signale au modèle que sa réponse n'avait aucun bloc.
    assert!(requests.lock().unwrap()[1].contains("aucun bloc SEARCH/REPLACE"));
}

#[tokio::test]
async fn task_uses_native_and_text_tool_calls() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("t");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("Cargo.toml"), "[package]\nname = \"t\"\nversion = \"0.1.0\"\nedition = \"2021\"\n").unwrap();
    std::fs::write(dir.join("src/main.rs"), "fn main() {\n    println!(\"ok\");\n}\n").unwrap();

    let edit = serde_json::json!({"tool": "edit_file", "args": {
        "path": "src/main.rs",
        "search": "fn main() {",
        "replace": "fn greet() -> &'static str {\n    \"salut\"\n}\n\nfn main() {\n    println!(\"{}\", greet());"
    }});
    let (url, requests) = fake_llm_seq(vec![
        // 1. appel natif (champ tool_calls)
        serde_json::json!({"role": "assistant", "content": "", "tool_calls": [{"id": "c1", "type": "function",
            "function": {"name": "read_file", "arguments": "{\"path\":\"src/main.rs\"}"}}]}),
        // 2. appel écrit dans le texte, comme le font beaucoup de petits modèles
        serde_json::json!({"role": "assistant", "content": format!("Je modifie main.\n```json\n{edit}\n```")}),
        // 3. fin
        serde_json::json!({"role": "assistant", "content": "J'ai ajouté `greet()`."}),
    ])
    .await;

    let cfg = local_config(url);
    let host = Arc::new(Recorder::default());
    let agent = Agent::new(Project::open(&dir).unwrap(), cfg, host.clone());
    agent.task("ajoute une fonction greet").await.unwrap();

    let src = std::fs::read_to_string(dir.join("src/main.rs")).unwrap();
    assert!(src.contains("fn greet()") && src.contains("greet());"), "{src}");
    let reqs = requests.lock().unwrap();
    assert_eq!(reqs.len(), 3);
    assert!(reqs[1].contains("src/main.rs (lignes 1-3)"), "le résultat de read_file doit revenir au modèle");
    assert!(reqs[0].contains("\"tools\""), "les outils sont proposés en natif");
    let events = host.0.lock().unwrap();
    assert!(events.iter().any(|e| matches!(e, Event::Done { ok: true, .. })));
    assert!(events.iter().any(|e| matches!(e, Event::StepStart { label, .. } if label == "édition src/main.rs")));
}

#[tokio::test]
async fn go_project_is_fixed_too() {
    if std::process::Command::new("go").arg("version").output().is_err() {
        eprintln!("go absent : test ignoré");
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("g");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("go.mod"), "module g\n\ngo 1.21\n").unwrap();
    std::fs::write(dir.join("main.go"), "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(y)\n}\n").unwrap();

    let (url, requests) = fake_llm("main.go\n<<<<<<< SEARCH\n\tfmt.Println(y)\n=======\n\tfmt.Println(\"ok\")\n>>>>>>> REPLACE\n").await;
    let agent = Agent::new(Project::open(&dir).unwrap(), local_config(url), Arc::new(Recorder::default()));
    let out = agent.fix().await.unwrap();
    assert!(out.ok, "{:?}", out.remaining);
    let req = requests.lock().unwrap()[0].clone();
    assert!(req.contains("undefined: y") && req.contains("main.go:6:14"), "{req}");
}

/// Langage que rien ne connaît : le modèle propose la commande, l'utilisateur
/// l'accepte, elle est enregistrée, puis la boucle corrige comme d'habitude.
#[cfg(unix)]
#[tokio::test]
async fn unknown_language_gets_commands_from_the_model() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("x");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("prog.xyz"), "debut\nINTERDIT\nfin\n").unwrap();
    std::fs::write(dir.join("verifie.sh"), "if grep -n INTERDIT prog.xyz >/dev/null; then echo \"prog.xyz:2: mot interdit\" >&2; exit 1; fi\n").unwrap();

    let (url, requests) = fake_llm_seq(vec![
        serde_json::json!({"role": "assistant", "content": "{\"build\": \"sh verifie.sh\", \"test\": null}"}),
        serde_json::json!({"role": "assistant", "content": "prog.xyz\n<<<<<<< SEARCH\nINTERDIT\n=======\nautorise\n>>>>>>> REPLACE\n"}),
    ])
    .await;
    let host = Arc::new(Recorder::allowing());
    let agent = Agent::new(Project::open(&dir).unwrap(), local_config(url), host.clone());
    assert_eq!(agent.build_cmd(), None);

    let out = agent.fix().await.unwrap();
    assert!(out.ok, "{:?}", out.remaining);
    assert_eq!(host.1.lock().unwrap()[0].detail, "build : sh verifie.sh\ntest  : —");
    let saved = std::fs::read_to_string(dir.join(".digital-arms/config.toml")).unwrap();
    assert!(saved.contains("build_cmd = \"sh verifie.sh\""), "{saved}");
    // L'erreur a été rattachée au bon fichier grâce au format générique.
    assert!(requests.lock().unwrap()[1].contains("## prog.xyz"));
}
