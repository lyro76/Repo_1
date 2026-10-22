//! `da` : le moteur de Digital Arms en ligne de commande. Utile sans interface,
//! en CI, et pour tester le moteur de bout en bout.

use std::io::{BufRead, IsTerminal, Read, Write};
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use clap::{Parser, Subcommand, ValueEnum};
use da_core::events::{ApprovalRequest, Stream};
use da_core::llm::OpenAiCompat;
use da_core::project::{scaffold, Lang};
use da_core::{Agent, Config, Decision, Event, Host, Mode, Project};
use tokio::sync::oneshot;

#[derive(Parser)]
#[command(name = "da", version, about = "Digital Arms — agent qui code et corrige, en local ou via l'API")]
struct Cli {
    /// Dossier du projet.
    #[arg(short = 'C', long, global = true, default_value = ".")]
    dir: PathBuf,
    #[arg(long, global = true)]
    mode: Option<CliMode>,
    /// Modèle local (ex : qwen2.5-coder:14b).
    #[arg(long, global = true)]
    model: Option<String>,
    /// URL du serveur compatible OpenAI (ex : http://localhost:1234/v1 pour LM Studio).
    #[arg(long, global = true)]
    url: Option<String>,
    /// Répond oui à toutes les demandes d'autorisation (sauf commandes dangereuses).
    #[arg(short = 'y', long, global = true)]
    yes: bool,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Clone, Copy, ValueEnum)]
enum CliMode {
    Local,
    Api,
    Auto,
}

#[derive(Subcommand)]
enum Cmd {
    /// Exécute une demande puis compile et corrige.
    Run { prompt: Vec<String> },
    /// Compile et corrige jusqu'à ce que le build passe.
    Fix,
    /// Index structurel : symboles du projet.
    Index {
        /// Ne montre que les symboles qui contiennent ce nom.
        #[arg(long)]
        find: Option<String>,
    },
    /// Parse une sortie de compilateur (fichier ou stdin) et affiche les diagnostics en JSON.
    Diag { file: Option<PathBuf> },
    /// Crée un nouveau projet (squelette déterministe, sans modèle).
    New { lang: NewLang, name: String },
    /// Annule un correctif à partir de son instantané.
    Undo { snapshot: String },
    /// Vérifie le serveur local et la clé API.
    Doctor,
}

#[derive(Clone, Copy, ValueEnum)]
enum NewLang {
    Rust,
    Cpp,
    Python,
}

struct CliHost {
    yes: bool,
}

impl Host for CliHost {
    fn emit(&self, e: Event) {
        match e {
            Event::Text { text } => println!("\n{text}\n"),
            Event::StepStart { label, .. } => eprintln!("  › {label}"),
            Event::StepEnd { summary, ok, .. } => eprintln!("    {} {summary}", if ok { "✓" } else { "✗" }),
            Event::Terminal { line, stream: Stream::Agent } => eprintln!("\x1b[34m{line}\x1b[0m"),
            Event::Terminal { line, .. } => eprintln!("\x1b[2m{line}\x1b[0m"),
            Event::Patch { file, diff, backend, snapshot, .. } => {
                eprintln!("\n  correctif ({backend}) sur {file} — annuler : da undo {snapshot}");
                for l in diff.lines().skip(2) {
                    let color = match l.as_bytes().first() {
                        Some(b'+') => "\x1b[32m",
                        Some(b'-') => "\x1b[31m",
                        _ => "\x1b[2m",
                    };
                    eprintln!("    {color}{l}\x1b[0m");
                }
            }
            Event::Escalated { reason } => eprintln!("\x1b[33m  ↑ escalade vers l'API : {reason}\x1b[0m"),
            Event::Done { ok, summary } => eprintln!("\n{} {summary}", if ok { "✓" } else { "✗" }),
            Event::Build { .. } | Event::Diagnostics { .. } | Event::Usage { .. } => {}
        }
    }

    fn approve(&self, req: ApprovalRequest) -> oneshot::Receiver<Decision> {
        let (tx, rx) = oneshot::channel();
        let auto = self.yes && !req.rule.is_empty();
        std::thread::spawn(move || {
            if auto {
                let _ = tx.send(Decision::Allow);
                return;
            }
            if !std::io::stdin().is_terminal() {
                let _ = tx.send(Decision::Deny);
                return;
            }
            let always = if req.rule.is_empty() { String::new() } else { format!(" / [t]oujours « {} »", req.rule) };
            eprint!("\n\x1b[33m⚠ {}\x1b[0m\n  {}\n  [o]ui / [n]on{always} ? ", req.title, req.detail.replace('\n', "\n  "));
            let _ = std::io::stderr().flush();
            let mut line = String::new();
            let _ = std::io::stdin().lock().read_line(&mut line);
            let d = match line.trim().to_lowercase().as_str() {
                "o" | "oui" | "y" | "yes" => Decision::Allow,
                "t" | "toujours" | "a" | "always" if !req.rule.is_empty() => Decision::AlwaysAllow,
                _ => Decision::Deny,
            };
            let _ = tx.send(d);
        });
        rx
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let host: Arc<dyn Host> = Arc::new(CliHost { yes: cli.yes });

    let agent = || -> Result<Agent> {
        let project = Project::open(&cli.dir)?;
        let mut cfg = Config::load(&project.root)?;
        if let Some(m) = cli.mode {
            cfg.mode = match m {
                CliMode::Local => Mode::Local,
                CliMode::Api => Mode::Api,
                CliMode::Auto => Mode::Auto,
            };
        }
        if let Some(m) = &cli.model {
            cfg.local.model = m.clone();
        }
        if let Some(u) = &cli.url {
            cfg.local.base_url = u.clone();
        }
        Ok(Agent::new(project, cfg, host.clone()))
    };

    match &cli.cmd {
        Cmd::Run { prompt } => agent()?.task(&prompt.join(" ")).await?,
        Cmd::Fix => {
            let out = agent()?.fix().await?;
            if !out.ok {
                for d in &out.remaining {
                    eprintln!("  ✗ {}", d.headline());
                }
                std::process::exit(1);
            }
            eprintln!("✓ build OK ({} tentative(s))", out.attempts);
        }
        Cmd::Index { find } => {
            let root = Project::open(&cli.dir)?.root;
            let idx = da_core::index::Index::build(&root)?;
            let syms: Vec<_> = match find {
                Some(q) => idx.find(q),
                None => idx.symbols.iter().collect(),
            };
            for s in &syms {
                println!("{:<7} {:<40} {}:{}", s.kind, s.name, s.file, s.line);
            }
            eprintln!("{} fichiers · {} symboles", idx.files.len(), idx.symbols.len());
        }
        Cmd::Diag { file } => {
            let mut text = String::new();
            match file {
                Some(f) => text = std::fs::read_to_string(f)?,
                None => {
                    std::io::stdin().read_to_string(&mut text)?;
                }
            }
            println!("{}", serde_json::to_string_pretty(&da_core::diag::parse(&text))?);
        }
        Cmd::New { lang, name } => {
            let lang = match lang {
                NewLang::Rust => Lang::Rust,
                NewLang::Cpp => Lang::Cpp,
                NewLang::Python => Lang::Python,
            };
            let dir = scaffold(&cli.dir, name, lang)?;
            eprintln!("✓ projet créé : {}", dir.display());
        }
        Cmd::Undo { snapshot } => {
            for f in agent()?.undo(snapshot)? {
                eprintln!("  restauré : {f}");
            }
        }
        Cmd::Doctor => {
            let a = agent()?;
            let cfg = &a.cfg;
            eprintln!("projet   {} ({:?})", a.project.root.display(), a.project.lang);
            eprintln!("build    {}", a.project.build_command(cfg).unwrap_or_else(|| "—".into()));
            eprintln!("mode     {:?}", cfg.mode);
            match OpenAiCompat::new(cfg.local.clone()).health().await {
                Ok(models) => {
                    let served = models.iter().any(|m| m == &cfg.local.model);
                    eprintln!("local    ✓ {} — {} modèle(s){}", cfg.local.base_url, models.len(), if served { String::new() } else { format!(", ✗ « {} » absent", cfg.local.model) });
                }
                Err(e) => eprintln!("local    ✗ {} : {e:#}", cfg.local.base_url),
            }
            eprintln!("api      {}", if Config::api_key().is_some() { format!("✓ clé présente · {}", cfg.api.model) } else { "— ANTHROPIC_API_KEY absent (mode Auto = local seul)".into() });
        }
    }
    Ok(())
}
