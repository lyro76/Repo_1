//! La boucle de l'agent : exécuter une tâche avec des outils, puis compiler
//! et corriger jusqu'à ce que le build passe.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{bail, Result};

use crate::config::{Config, Mode};
use crate::diag::{self, Diagnostic};
use crate::edit::{self, Snapshot};
use crate::events::{Event, Host, Stream};
use crate::llm::{Backend, Msg, Which};
use crate::memory::{FixMemory, FixRecord, Notes};
use crate::permissions::Permissions;
use crate::project::Project;
use crate::tools::{self, Toolbox};

const TASK_SYSTEM: &str = "Tu es Digital Arms, un agent de programmation qui travaille dans le projet de l'utilisateur.
Règles :
- Explore avant d'écrire : find_symbol, outline et search coûtent moins cher que lire des fichiers entiers.
- Modifie avec edit_file en copiant exactement le passage à remplacer ; write_file seulement pour un nouveau fichier.
- Fais le plus petit changement qui répond à la demande. Respecte le style et les conventions de NOTES.md.
- Après tes modifications, appelle build. Si ça casse, corrige.
- Si une décision durable est prise (convention, dépendance, piège), ajoute-la avec note.
- Quand tu as fini, réponds sans appeler d'outil : 2 à 4 phrases, en français, sur ce que tu as fait.";

const FIX_SYSTEM: &str = "Tu corriges des erreurs de compilation ou de test. Réponds UNIQUEMENT avec un ou plusieurs blocs de modification, au format :

chemin/du/fichier
<<<<<<< SEARCH
lignes exactes à remplacer, copiées du fichier
=======
nouvelles lignes
>>>>>>> REPLACE

Règles : SEARCH doit être copié à l'identique et assez long pour être unique. Corrige la cause, pas le symptôme : ne supprime pas de code utile, ne désactive pas de tests, n'ajoute pas d'unwrap()/except vide pour faire taire une erreur. Une phrase d'explication avant les blocs, au plus.";

const PLAN_SYSTEM: &str = "Tu planifies une tâche de programmation qu'un petit modèle local exécutera ensuite, étape par étape, avec des outils (lire, chercher, éditer, compiler). Écris un plan numéroté, concret et court (au plus 10 étapes) : pour chaque étape, le fichier concerné et ce qu'il faut y écrire (signatures, types, noms). Pas de code complet, pas de préambule.";

/// Identifiants des demandes d'autorisation, uniques pour le processus.
static APPROVALS: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, serde::Serialize)]
pub struct FixOutcome {
    pub ok: bool,
    pub attempts: u32,
    pub remaining: Vec<Diagnostic>,
    pub snapshots: Vec<String>,
}

pub struct Agent {
    pub project: Project,
    pub cfg: Config,
    host: Arc<dyn Host>,
    local: Backend,
    api: Option<Backend>,
    calls: Mutex<HashMap<&'static str, u32>>,
}

impl Agent {
    pub fn new(project: Project, cfg: Config, host: Arc<dyn Host>) -> Self {
        let local = Backend::local(&cfg);
        let api = Backend::api(&cfg);
        Self { project, cfg, host, local, api, calls: Mutex::default() }
    }

    pub fn open(root: &Path, host: Arc<dyn Host>) -> Result<Self> {
        let project = Project::open(root)?;
        let cfg = Config::load(&project.root)?;
        Ok(Self::new(project, cfg, host))
    }

    pub fn host(&self) -> &Arc<dyn Host> {
        &self.host
    }

    fn emit(&self, e: Event) {
        self.host.emit(e);
    }

    fn step(&self, label: impl Into<String>) -> u64 {
        // Unique pour tout le processus : l'interface garde l'historique de plusieurs agents.
        static IDS: AtomicU64 = AtomicU64::new(1);
        let id = IDS.fetch_add(1, Ordering::Relaxed);
        self.emit(Event::StepStart { id, label: label.into() });
        id
    }

    fn end(&self, id: u64, summary: impl Into<String>, ok: bool) {
        self.emit(Event::StepEnd { id, summary: summary.into(), ok });
    }

    /// Le backend de départ selon le mode.
    fn primary(&self) -> Result<&Backend> {
        match self.cfg.mode {
            Mode::Local | Mode::Auto => Ok(&self.local),
            Mode::Api => self.api.as_ref().ok_or_else(|| anyhow::anyhow!("mode API choisi mais ANTHROPIC_API_KEY n'est pas défini")),
        }
    }

    /// Le backend de secours en Auto (l'API), s'il existe.
    fn escalation(&self) -> Option<&Backend> {
        (self.cfg.mode == Mode::Auto).then_some(self.api.as_ref()).flatten()
    }

    async fn chat(&self, backend: &Backend, system: &str, msgs: &[Msg], tools: &[crate::llm::ToolSpec]) -> Result<crate::llm::Reply> {
        let reply = backend.chat(system, msgs, tools).await?;
        let key = match backend.which() {
            Which::Local => "local",
            Which::Api => "api",
        };
        let n = {
            let mut c = self.calls.lock().unwrap();
            *c.entry(key).or_default() += 1;
            c[key]
        };
        self.emit(Event::Usage { backend: key.into(), calls: n });
        Ok(reply)
    }

    fn context(&self) -> String {
        let notes = Notes::new(&self.project.root).read();
        let files: Vec<String> = crate::index::walk(&self.project.root).iter().take(200).map(|p| crate::index::rel(p)).collect();
        format!(
            "## Projet\nNom : {}\nLangage : {:?}\nBuild : {}\n\n## NOTES.md\n{}\n\n## Fichiers\n{}",
            self.project.name(),
            self.project.lang,
            self.project.build_command(&self.cfg).unwrap_or_else(|| "(inconnu)".into()),
            if notes.trim().is_empty() { "(vide)" } else { notes.trim() },
            files.join("\n")
        )
    }

    /// Exécute une demande libre (« ajoute un timeout configurable au client réseau »).
    pub async fn task(&self, prompt: &str) -> Result<()> {
        let system = format!("{TASK_SYSTEM}\n\n{}", self.context());
        let mut user = prompt.to_string();

        // En Auto, l'API écrit le plan d'une tâche de création, le local l'exécute.
        if let (Some(api), true) = (self.escalation(), looks_like_creation(prompt)) {
            let id = self.step("plan");
            match self.chat(api, PLAN_SYSTEM, &[Msg::User(format!("{}\n\n## Demande\n{prompt}", self.context()))], &[]).await {
                Ok(plan) => {
                    self.end(id, "api", true);
                    self.emit(Event::Text { text: format!("Plan :\n{}", plan.text.trim()) });
                    user = format!("{prompt}\n\n## Plan à suivre\n{}", plan.text.trim());
                }
                Err(e) => self.end(id, format!("ignoré : {e}"), false),
            }
        }

        let toolbox = self.toolbox();
        let specs = tools::specs();
        let mut msgs = vec![Msg::User(user)];
        let mut backend = self.primary()?;
        let mut seen: HashMap<String, u32> = HashMap::new();
        let mut finished = false;

        for _ in 0..self.cfg.max_steps {
            let reply = match self.chat(backend, &system, &msgs, &specs).await {
                Ok(r) => r,
                Err(e) if backend.which() == Which::Local && self.escalation().is_some() => {
                    self.emit(Event::Escalated { reason: format!("modèle local indisponible : {e:#}") });
                    backend = self.escalation().unwrap();
                    continue;
                }
                Err(e) => return Err(e),
            };
            if !reply.text.trim().is_empty() {
                self.emit(Event::Text { text: reply.text.trim().to_string() });
            }
            if reply.tool_calls.is_empty() {
                if reply.truncated {
                    msgs.push(reply.into_msg());
                    msgs.push(Msg::User("Ta réponse a été coupée. Continue.".into()));
                    continue;
                }
                finished = true;
                break;
            }
            let calls = reply.tool_calls.clone();
            msgs.push(reply.into_msg());

            let mut looping = false;
            for call in calls {
                let key = format!("{}{}", call.name, call.args);
                let count = seen.entry(key).or_default();
                *count += 1;
                looping |= *count >= 3;

                let id = self.step(Toolbox::label(&call.name, &call.args));
                let out = toolbox.call(&call.name, &call.args).await;
                self.end(id, &out.summary, !out.is_error);
                msgs.push(Msg::ToolResult { id: call.id, name: call.name, content: out.content, is_error: out.is_error });
            }
            // Un petit modèle qui répète le même appel tourne en rond.
            if looping {
                match (backend.which(), self.escalation()) {
                    (Which::Local, Some(api)) => {
                        self.emit(Event::Escalated { reason: "le modèle local répète les mêmes actions".into() });
                        backend = api;
                        seen.clear();
                    }
                    _ => {
                        msgs.push(Msg::User("Tu répètes les mêmes actions. Change d'approche ou termine en expliquant ce qui bloque.".into()));
                        seen.clear();
                    }
                }
            }
        }
        self.save_snapshot(&toolbox);

        if !finished {
            self.emit(Event::Text { text: format!("Arrêt après {} actions. Relance la tâche pour continuer.", self.cfg.max_steps) });
        }
        if self.cfg.auto_fix && self.project.build_command(&self.cfg).is_some() {
            let out = self.fix().await?;
            self.emit(Event::Done { ok: out.ok, summary: if out.ok { "build OK".into() } else { format!("{} erreur(s) restantes", out.remaining.len()) } });
        } else {
            self.emit(Event::Done { ok: finished, summary: "terminé".into() });
        }
        Ok(())
    }

    fn toolbox(&self) -> Toolbox<'_> {
        Toolbox {
            project: &self.project,
            cfg: &self.cfg,
            host: self.host.as_ref(),
            perms: Mutex::new(Permissions::load(&self.project.root)),
            snapshot: Mutex::new(Snapshot::new(new_id())),
            approval_ids: &APPROVALS,
        }
    }

    fn save_snapshot(&self, toolbox: &Toolbox) {
        let snap = toolbox.snapshot.lock().unwrap();
        if !snap.files.is_empty() {
            let _ = snap.save(&self.project.root);
        }
    }

    async fn build(&self) -> Result<(bool, Vec<Diagnostic>)> {
        let Some(cmd) = self.project.build_command(&self.cfg) else { bail!("pas de commande de build connue") };
        let id = self.step(short_cmd(&cmd));
        let out = self.project.run(&cmd, self.host.as_ref(), Duration::from_secs(600)).await?;
        let diags = diag::parse(&out.output);
        let errs = diag::errors(&diags).len();
        let ok = out.ok && errs == 0;
        let errs_shown = if ok { 0 } else { errs.max(1) };
        self.end(id, if ok { format!("OK · {:.1} s", out.seconds).replace('.', ",") } else { plural(errs_shown, "erreur") }, ok);
        self.emit(Event::Build { ok, errors: errs_shown, seconds: out.seconds });
        if !ok && errs == 0 {
            // Échec sans diagnostic reconnu : on fabrique une erreur avec la fin de la sortie.
            let tail: Vec<&str> = out.output.lines().rev().take(25).collect();
            let message = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
            return Ok((false, vec![Diagnostic { file: String::new(), line: 0, column: 0, level: diag::Level::Error, code: None, message, notes: vec![], suggestions: vec![] }]));
        }
        Ok((ok, diags))
    }

    /// Compile et corrige jusqu'à ce que ça passe ou que les tentatives soient épuisées.
    pub async fn fix(&self) -> Result<FixOutcome> {
        let root = self.project.root.clone();
        let memory = FixMemory::new(&root);
        let max = self.cfg.max_attempts;
        let mut snapshots = Vec::new();
        let mut attempts = 0;
        let mut tried_suggestions = false;
        let mut conversation: Vec<Msg> = Vec::new();
        let mut backend = self.primary()?;
        let mut backend_attempts = 0;
        let mut pending: Vec<(Diagnostic, String, String)> = Vec::new();
        let mut feedback = String::new();
        // Suggestion « peut-être correcte » essayée : (instantané, erreurs d'avant).
        let mut trial: Option<(String, Vec<Diagnostic>)> = None;

        loop {
            let (ok, diags) = self.build().await?;
            let mut errors: Vec<Diagnostic> = diags.iter().filter(|d| d.is_error()).cloned().collect();

            // Une suggestion incertaine qui n'a rien arrangé est annulée.
            if let Some((snap, before)) = trial.take() {
                if !ok && errors.len() >= before.len() {
                    Snapshot::restore(&root, &snap)?;
                    snapshots.retain(|s| s != &snap);
                    self.emit(Event::Terminal { line: "agent › suggestion du compilateur annulée (sans effet)".into(), stream: Stream::Agent });
                    errors = before;
                }
            }

            // Les correctifs qui ont fait disparaître leur erreur vont en mémoire.
            for (d, diff, by) in pending.drain(..) {
                if !errors.iter().any(|e| e.code == d.code && e.message == d.message && e.file == d.file) {
                    let _ = memory.record(&FixRecord { code: d.code.clone(), message: d.message.clone(), file: d.file.clone(), diff, backend: by });
                }
            }

            if ok {
                return Ok(FixOutcome { ok: true, attempts, remaining: vec![], snapshots });
            }
            self.emit(Event::Diagnostics { items: errors.clone() });
            self.emit(Event::Terminal { line: format!("agent › {} erreur(s) capturée(s), correction en cours ({})", errors.len(), backend_name(backend)), stream: Stream::Agent });

            // 1. Les suggestions sûres du compilateur, sans modèle.
            if !tried_suggestions {
                tried_suggestions = true;
                if let Some((snap, certain)) = self.apply_compiler_suggestions(&errors)? {
                    snapshots.push(snap.clone());
                    if !certain {
                        trial = Some((snap, errors.clone()));
                    }
                    continue;
                }
            }

            // 2. Le modèle, avec escalade éventuelle.
            if backend_attempts >= max {
                match (backend.which(), self.escalation()) {
                    (Which::Local, Some(api)) => {
                        self.emit(Event::Escalated { reason: format!("{max} tentatives locales sans succès") });
                        backend = api;
                        backend_attempts = 0;
                        conversation.clear();
                    }
                    _ => return Ok(FixOutcome { ok: false, attempts, remaining: errors, snapshots }),
                }
            }
            attempts += 1;
            backend_attempts += 1;

            let prompt = self.fix_prompt(&errors, &memory, conversation.is_empty());
            conversation.push(Msg::User(format!("{}{prompt}", std::mem::take(&mut feedback))));
            let id = self.step(format!("correctif · tentative {backend_attempts}/{max}"));
            let reply = match self.chat(backend, FIX_SYSTEM, &conversation, &[]).await {
                Ok(r) => r,
                Err(e) => {
                    self.end(id, "erreur modèle", false);
                    if let (Which::Local, Some(_)) = (backend.which(), self.escalation()) {
                        backend_attempts = max;
                        conversation.pop();
                        continue;
                    }
                    return Err(e);
                }
            };
            let blocks = edit::parse_blocks(&reply.text);
            conversation.push(reply.clone().into_msg());

            let mut snap = Snapshot::new(new_id());
            let mut problems = Vec::new();
            for b in &blocks {
                let Ok(full) = tools::safe_path(&root, &b.file) else {
                    problems.push(format!("{} : chemin refusé", b.file));
                    continue;
                };
                let before = std::fs::read_to_string(&full).unwrap_or_default();
                match edit::apply_block(&before, &b.search, &b.replace) {
                    Ok(after) => {
                        snap.remember(&root, &b.file);
                        std::fs::write(&full, &after)?;
                        let diff = edit::unified_diff(&b.file, &before, &after);
                        self.emit(Event::Patch { snapshot: snap.id.clone(), file: b.file.clone(), diff: diff.clone(), attempt: backend_attempts, backend: backend_name(backend).into() });
                        if let Some(d) = errors.iter().find(|d| d.file == b.file).or(errors.first()) {
                            pending.push((d.clone(), diff, backend_name(backend).into()));
                        }
                    }
                    Err(e) => problems.push(format!("{} : {e}", b.file)),
                }
            }
            let applied = snap.files.len();
            if applied > 0 {
                snap.save(&root)?;
                snapshots.push(snap.id.clone());
            }
            self.end(id, format!("{applied} fichier(s) · {}", backend_name(backend)), applied > 0);
            if blocks.is_empty() {
                problems.push("aucun bloc SEARCH/REPLACE dans ta réponse".into());
            }
            if !problems.is_empty() {
                feedback = format!(
                    "Certains blocs de ta réponse précédente n'ont pas pu être appliqués :\n- {}\nRecopie SEARCH exactement depuis le fichier.\n\n",
                    problems.join("\n- ")
                );
            }
        }
    }

    /// Applique les suggestions du compilateur. Renvoie l'instantané et si
    /// toutes étaient sûres (`MachineApplicable`) ; sinon on n'en garde
    /// qu'une par erreur à suggestion unique, à vérifier au build suivant.
    fn apply_compiler_suggestions(&self, errors: &[Diagnostic]) -> Result<Option<(String, bool)>> {
        let root = &self.project.root;
        let sure: Vec<&diag::Suggestion> = errors.iter().flat_map(|d| d.suggestions.iter()).filter(|s| s.machine_applicable).collect();
        let certain = !sure.is_empty();
        let chosen: Vec<&diag::Suggestion> = if certain {
            sure
        } else {
            errors.iter().filter(|d| d.suggestions.len() == 1).map(|d| &d.suggestions[0]).collect()
        };
        // Une seule suggestion par fichier par passe : les positions des suivantes deviendraient fausses.
        let mut by_file: HashMap<String, &diag::Suggestion> = HashMap::new();
        for s in chosen {
            by_file.entry(s.file.clone()).or_insert(s);
        }
        if by_file.is_empty() {
            return Ok(None);
        }
        let id = self.step("suggestions du compilateur");
        let mut snap = Snapshot::new(new_id());
        for (file, s) in by_file {
            let Ok(full) = tools::safe_path(root, &file) else { continue };
            let Ok(before) = std::fs::read_to_string(&full) else { continue };
            if let Ok(after) = edit::apply_suggestion(&before, s) {
                snap.remember(root, &file);
                std::fs::write(&full, &after)?;
                self.emit(Event::Patch { snapshot: snap.id.clone(), file: file.clone(), diff: edit::unified_diff(&file, &before, &after), attempt: 0, backend: "compilateur".into() });
            }
        }
        let n = snap.files.len();
        self.end(id, format!("{n} appliquée(s)"), n > 0);
        if n == 0 {
            return Ok(None);
        }
        snap.save(root)?;
        Ok(Some((snap.id, certain)))
    }

    fn fix_prompt(&self, errors: &[Diagnostic], memory: &FixMemory, first: bool) -> String {
        let root = &self.project.root;
        let mut p = String::new();
        if first {
            let notes = Notes::new(root).read();
            if !notes.trim().is_empty() {
                p.push_str(&format!("## NOTES.md\n{}\n\n", notes.trim()));
            }
        } else {
            p.push_str("Le build échoue encore après ta modification.\n\n");
        }
        p.push_str("## Erreurs\n");
        for d in errors.iter().take(5) {
            p.push_str(&format!("- {}\n", d.headline()));
            for n in d.notes.iter().take(4) {
                p.push_str(&format!("    {n}\n"));
            }
            for s in d.suggestions.iter().take(2) {
                p.push_str(&format!("    suggestion du compilateur ({}:{}) : remplacer par `{}`\n", s.file, s.line_start, s.replacement));
            }
        }

        let mut shown = Vec::new();
        for d in errors.iter().take(5) {
            if d.file.is_empty() || shown.contains(&d.file) {
                continue;
            }
            let Ok(full) = tools::safe_path(root, &d.file) else { continue };
            let Ok(src) = std::fs::read_to_string(full) else { continue };
            shown.push(d.file.clone());
            let lines: Vec<&str> = src.lines().collect();
            let (a, b) = if lines.len() <= 250 { (0, lines.len()) } else { (d.line.saturating_sub(40) as usize, (d.line as usize + 40).min(lines.len())) };
            p.push_str(&format!("\n## {} (lignes {}-{} sur {})\n```\n{}\n```\n", d.file, a + 1, b, lines.len(), lines[a..b].join("\n")));
        }

        let past: Vec<FixRecord> = errors.iter().take(3).flat_map(|d| memory.similar(d, 1)).collect();
        if !past.is_empty() {
            p.push_str("\n## Correctifs qui ont déjà marché sur des erreurs semblables dans ce projet\n");
            for r in past {
                p.push_str(&format!("{}\n```diff\n{}\n```\n", r.message, r.diff.trim()));
            }
        }
        p
    }

    /// Annule un correctif (bouton « Annuler ce correctif »).
    pub fn undo(&self, snapshot: &str) -> Result<Vec<String>> {
        Snapshot::restore(&self.project.root, snapshot)
    }
}

fn backend_name(b: &Backend) -> &'static str {
    match b.which() {
        Which::Local => "local",
        Which::Api => "api",
    }
}

fn plural(n: usize, word: &str) -> String {
    format!("{n} {word}{}", if n > 1 { "s" } else { "" })
}

fn short_cmd(cmd: &str) -> String {
    cmd.split_whitespace().filter(|w| !w.starts_with("--message-format")).collect::<Vec<_>>().join(" ")
}

fn new_id() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("{}-{:03}", t.as_secs(), t.subsec_millis())
}

fn looks_like_creation(prompt: &str) -> bool {
    let p = prompt.to_lowercase();
    ["crée", "créer", "cree", "nouveau", "nouvelle", "implémente", "implemente", "ajoute", "écris", "ecris", "génère", "create", "implement", "add ", "build a", "write a"]
        .iter()
        .any(|w| p.contains(w))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creation_heuristic() {
        assert!(looks_like_creation("Crée un parseur TOML"));
        assert!(looks_like_creation("ajoute un timeout configurable"));
        assert!(!looks_like_creation("pourquoi ce test échoue ?"));
    }

    #[test]
    fn short_command() {
        assert_eq!(short_cmd("cargo build --message-format=json"), "cargo build");
    }
}
