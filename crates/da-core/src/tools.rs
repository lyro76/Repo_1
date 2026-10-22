//! Les outils que le modèle peut appeler pendant une tâche.

use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};

use crate::edit::{self, Snapshot};
use crate::events::{ApprovalRequest, Decision, Host};
use crate::index::{self, Index};
use crate::llm::ToolSpec;
use crate::memory::Notes;
use crate::permissions::{Permissions, Verdict};
use crate::project::Project;

/// Sorties renvoyées au modèle : on coupe pour ne pas noyer un contexte de 16k.
const MAX_OUTPUT: usize = 6_000;
const MAX_READ_LINES: usize = 400;

pub fn specs() -> Vec<ToolSpec> {
    let obj = |props: Value, req: &[&str]| json!({"type": "object", "properties": props, "required": req});
    vec![
        ToolSpec {
            name: "list_files",
            description: "Liste les fichiers du projet (respecte .gitignore). `dir` optionnel pour un sous-dossier.",
            schema: obj(json!({"dir": {"type": "string"}}), &[]),
        },
        ToolSpec {
            name: "read_file",
            description: "Lit un fichier. `start`/`end` (1-based, inclus) pour une plage ; 400 lignes max par lecture.",
            schema: obj(json!({"path": {"type": "string"}, "start": {"type": "integer"}, "end": {"type": "integer"}}), &["path"]),
        },
        ToolSpec {
            name: "search",
            description: "Recherche une regex dans tous les fichiers du projet. Renvoie fichier:ligne: texte.",
            schema: obj(json!({"pattern": {"type": "string"}}), &["pattern"]),
        },
        ToolSpec {
            name: "find_symbol",
            description: "Trouve où sont définis une fonction, struct, classe, trait ou module par son nom.",
            schema: obj(json!({"name": {"type": "string"}}), &["name"]),
        },
        ToolSpec {
            name: "outline",
            description: "Plan d'un fichier : ses symboles et leurs lignes, sans le contenu.",
            schema: obj(json!({"path": {"type": "string"}}), &["path"]),
        },
        ToolSpec {
            name: "edit_file",
            description: "Remplace un passage EXACT et unique d'un fichier. `search` doit être copié du fichier, avec assez de contexte pour être unique.",
            schema: obj(json!({"path": {"type": "string"}, "search": {"type": "string"}, "replace": {"type": "string"}}), &["path", "search", "replace"]),
        },
        ToolSpec {
            name: "write_file",
            description: "Crée un fichier ou le remplace entièrement. Préfère edit_file pour modifier un fichier existant.",
            schema: obj(json!({"path": {"type": "string"}, "content": {"type": "string"}}), &["path", "content"]),
        },
        ToolSpec {
            name: "run_command",
            description: "Lance une commande shell à la racine du projet (ex: `cargo add serde`, `pytest -k x`). Certaines demandent l'accord de l'utilisateur.",
            schema: obj(json!({"command": {"type": "string"}}), &["command"]),
        },
        ToolSpec {
            name: "build",
            description: "Compile le projet (ou vérifie la syntaxe en Python) et renvoie les erreurs parsées.",
            schema: obj(json!({}), &[]),
        },
        ToolSpec {
            name: "note",
            description: "Ajoute une ligne durable à NOTES.md (convention, décision, piège). `section` : Conventions, Décisions ou Ne pas toucher.",
            schema: obj(json!({"section": {"type": "string"}, "text": {"type": "string"}}), &["section", "text"]),
        },
    ]
}

/// État partagé par les outils pendant une tâche.
pub struct Toolbox<'a> {
    pub project: &'a Project,
    pub cfg: &'a crate::Config,
    pub host: &'a dyn Host,
    pub perms: Mutex<Permissions>,
    pub snapshot: Mutex<Snapshot>,
    pub approval_ids: &'a std::sync::atomic::AtomicU64,
    pub build_cmd: Option<String>,
}

/// Résultat d'un outil : texte pour le modèle, résumé court pour l'interface.
pub struct Output {
    pub content: String,
    pub summary: String,
    pub is_error: bool,
}

impl<'a> Toolbox<'a> {
    pub fn label(name: &str, args: &Value) -> String {
        let s = |k: &str| args[k].as_str().unwrap_or("").to_string();
        match name {
            "read_file" => match (args["start"].as_u64(), args["end"].as_u64()) {
                (Some(a), Some(b)) => format!("lecture {}:{a}-{b}", s("path")),
                _ => format!("lecture {}", s("path")),
            },
            "edit_file" | "write_file" => format!("édition {}", s("path")),
            "search" => format!("recherche « {} »", s("pattern")),
            "find_symbol" => format!("symbole {}", s("name")),
            "outline" => format!("plan {}", s("path")),
            "list_files" => "arborescence".into(),
            "run_command" => s("command"),
            "build" => "build".into(),
            "note" => "NOTES.md".into(),
            other => other.to_string(),
        }
    }

    pub async fn call(&self, name: &str, args: &Value) -> Output {
        match self.dispatch(name, args).await {
            Ok((content, summary)) => Output { content: clip(content), summary, is_error: false },
            Err(e) => Output { content: format!("{e:#}"), summary: "échec".into(), is_error: true },
        }
    }

    async fn dispatch(&self, name: &str, a: &Value) -> Result<(String, String)> {
        let root = &self.project.root;
        let arg = |k: &str| a[k].as_str().ok_or_else(|| anyhow!("paramètre `{k}` manquant"));
        match name {
            "list_files" => {
                let dir = a["dir"].as_str().unwrap_or("").trim_matches('/');
                let files: Vec<String> = index::walk(root).iter().map(|p| index::rel(p)).filter(|f| dir.is_empty() || f.starts_with(&format!("{dir}/"))).collect();
                let n = files.len();
                Ok((files.join("\n"), format!("{n} fichiers")))
            }
            "read_file" => {
                let path = arg("path")?;
                let text = std::fs::read_to_string(safe_path(root, path)?).with_context(|| format!("lecture de {path}"))?;
                let lines: Vec<&str> = text.lines().collect();
                let start = a["start"].as_u64().unwrap_or(1).max(1) as usize;
                let end = (a["end"].as_u64().map(|e| e as usize).unwrap_or(lines.len())).min(lines.len()).min(start + MAX_READ_LINES - 1);
                let body: String = lines.get(start - 1..end).unwrap_or(&[]).iter().enumerate().map(|(i, l)| format!("{:>5} | {l}\n", start + i)).collect();
                let more = if end < lines.len() { format!("\n… ({} lignes au total, lis la suite avec start={})", lines.len(), end + 1) } else { String::new() };
                Ok((format!("{path} (lignes {start}-{end}) :\n{body}{more}"), format!("{} lignes", end + 1 - start)))
            }
            "search" => {
                let hits = index::search(root, arg("pattern")?, 60)?;
                let n = hits.len();
                Ok((hits.iter().map(|h| format!("{}:{}: {}", h.file, h.line, h.text)).collect::<Vec<_>>().join("\n"), format!("{n} résultats")))
            }
            "find_symbol" | "outline" => {
                let idx = Index::build(root)?;
                let syms = if name == "outline" { idx.outline(arg("path")?) } else { idx.find(arg("name")?) };
                let n = syms.len();
                Ok((syms.iter().map(|s| format!("{} {} — {}:{}", s.kind, s.name, s.file, s.line)).collect::<Vec<_>>().join("\n"), format!("{n} symboles")))
            }
            "edit_file" | "write_file" => {
                let path = arg("path")?;
                let full = safe_path(root, path)?;
                let before = std::fs::read_to_string(&full).unwrap_or_default();
                let after = if name == "write_file" { arg("content")?.to_string() } else { edit::apply_block(&before, arg("search")?, arg("replace")?)? };
                let diff = edit::unified_diff(path, &before, &after);
                if self.cfg.confirm_writes {
                    self.ask(format!("Écrire {path} ?"), diff.clone(), format!("write {path}"), false).await?;
                }
                self.snapshot.lock().unwrap().remember(root, path);
                if let Some(parent) = full.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&full, &after)?;
                let (plus, minus) = count_changes(&diff);
                Ok((format!("{path} modifié (+{plus} -{minus})"), format!("+{plus} -{minus}")))
            }
            "run_command" => {
                let cmd = arg("command")?;
                let verdict = self.perms.lock().unwrap().check(cmd);
                match verdict {
                    Verdict::Allowed => {}
                    Verdict::Ask { rule } => self.ask("Lancer une commande ?".into(), cmd.into(), rule, true).await?,
                    Verdict::Dangerous { rule } => self.ask("Commande sensible — confirmer ?".into(), cmd.into(), rule, false).await?,
                }
                let out = self.project.run(cmd, self.host, Duration::from_secs(600)).await?;
                let status = if out.ok { "OK".to_string() } else { format!("code {}", out.code.unwrap_or(-1)) };
                Ok((format!("[{status}]\n{}", tail(&out.output)), format!("{status} · {:.1} s", out.seconds)))
            }
            "build" => {
                let cmd = self.build_cmd.clone().ok_or_else(|| {
                    anyhow!("pas encore de commande de build pour ce projet. Si tu connais la commande standard du langage, lance-la avec run_command ; elle sera proposée à l'utilisateur à la fin de la tâche.")
                })?;
                let out = self.project.run(&cmd, self.host, Duration::from_secs(600)).await?;
                let diags = crate::diag::parse(&out.output);
                let errs = crate::diag::errors(&diags);
                if out.ok && errs.is_empty() {
                    return Ok(("Build OK".into(), format!("OK · {:.1} s", out.seconds)));
                }
                let mut s = format!("Build en échec, {} erreur(s) :\n", errs.len().max(1));
                for d in errs.iter().take(8) {
                    s.push_str(&format!("- {}\n", d.headline()));
                    for n in d.notes.iter().take(3) {
                        s.push_str(&format!("    {n}\n"));
                    }
                }
                if errs.is_empty() {
                    s.push_str(&tail(&out.output));
                }
                let n = errs.len().max(1);
                Ok((s, format!("{n} erreur{}", if n > 1 { "s" } else { "" })))
            }
            "note" => {
                Notes::new(root).add(arg("section")?, arg("text")?)?;
                Ok(("Noté.".into(), "noté".into()))
            }
            other => bail!("outil inconnu : {other}"),
        }
    }

    /// Pose la question à l'utilisateur ; `Err` si refusé.
    async fn ask(&self, title: String, detail: String, rule: String, offer_always: bool) -> Result<()> {
        let id = self.approval_ids.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let rule_shown = if offer_always { rule.clone() } else { String::new() };
        let decision = self.host.approve(ApprovalRequest { id, title, detail, rule: rule_shown }).await.unwrap_or(Decision::Deny);
        match decision {
            Decision::Allow => Ok(()),
            Decision::AlwaysAllow if offer_always => self.perms.lock().unwrap().always_allow(&rule),
            Decision::AlwaysAllow => Ok(()),
            Decision::Deny => bail!("l'utilisateur a refusé. Propose une autre approche ou explique pourquoi c'est nécessaire."),
        }
    }
}

/// Refuse tout chemin qui sortirait du projet.
pub fn safe_path(root: &Path, rel: &str) -> Result<PathBuf> {
    let p = Path::new(rel.trim_start_matches("./"));
    if p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir | Component::Prefix(_))) {
        bail!("chemin refusé (hors du projet) : {rel}");
    }
    Ok(root.join(p))
}

fn count_changes(diff: &str) -> (usize, usize) {
    let lines = diff.lines().filter(|l| !l.starts_with("+++") && !l.starts_with("---"));
    lines.fold((0, 0), |(p, m), l| match l.as_bytes().first() {
        Some(b'+') => (p + 1, m),
        Some(b'-') => (p, m + 1),
        _ => (p, m),
    })
}

fn clip(s: String) -> String {
    if s.len() <= MAX_OUTPUT {
        return s;
    }
    let cut = s.char_indices().take_while(|(i, _)| *i < MAX_OUTPUT).last().map(|(i, _)| i).unwrap_or(0);
    format!("{}\n… (sortie coupée, {} octets au total)", &s[..cut], s.len())
}

/// Fin de sortie de commande : c'est là que sont les erreurs.
fn tail(s: &str) -> String {
    let lines: Vec<&str> = s.lines().filter(|l| !l.starts_with("{\"reason\"")).collect();
    lines[lines.len().saturating_sub(80)..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_inside() {
        let root = Path::new("/p");
        assert!(safe_path(root, "src/a.rs").is_ok());
        assert!(safe_path(root, "./src/a.rs").is_ok());
        assert!(safe_path(root, "../etc/passwd").is_err());
        assert!(safe_path(root, "/etc/passwd").is_err());
    }
}
