//! La boucle de l'agent : exécuter une tâche avec des outils, puis compiler
//! et corriger jusqu'à ce que le build passe.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{bail, Result};

use crate::config::{Config, Mode};
use crate::conversation::{self, Conversation, Turn};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Build,
    Tests,
}

/// Identifiants des demandes d'autorisation, uniques pour le processus.
static APPROVALS: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, serde::Serialize)]
pub struct FixOutcome {
    pub ok: bool,
    /// `Some(true)` si les tests ont été lancés et passent.
    pub tests: Option<bool>,
    pub attempts: u32,
    pub remaining: Vec<Diagnostic>,
    pub snapshots: Vec<String>,
}

impl FixOutcome {
    /// « build OK », « build et tests OK », « 2 erreur(s) restantes »…
    pub fn summary(&self) -> String {
        match (self.ok, self.tests) {
            (true, Some(true)) => "build et tests OK".into(),
            (true, _) => "build OK".into(),
            (false, _) => format!("{} erreur(s) restantes", self.remaining.len()),
        }
    }
}

pub struct Agent {
    pub project: Project,
    pub cfg: Config,
    host: Arc<dyn Host>,
    local: Backend,
    api: Option<Backend>,
    calls: Mutex<HashMap<&'static str, u32>>,
    /// Commandes proposées par le modèle et acceptées pendant cette session.
    inferred: Mutex<Option<Commands>>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
struct Commands {
    build: Option<String>,
    test: Option<String>,
}

impl Agent {
    pub fn new(project: Project, cfg: Config, host: Arc<dyn Host>) -> Self {
        let local = Backend::local(&cfg);
        let api = Backend::api(&cfg);
        Self { project, cfg, host, local, api, calls: Mutex::default(), inferred: Mutex::default() }
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
            "## Projet\nNom : {}\nLangage : {}\nBuild : {}\n\n## NOTES.md\n{}\n\n## Fichiers\n{}",
            self.project.name(),
            self.project.kind().name,
            self.build_cmd().unwrap_or_else(|| "(pas encore connue)".into()),
            if notes.trim().is_empty() { "(vide)" } else { notes.trim() },
            files.join("\n")
        )
    }

    /// Exécute une demande libre (« ajoute un timeout configurable au client réseau »).
    ///
    /// L'agent connaît les échanges précédents de la conversation (résumés),
    /// et celui-ci y est ajouté à la fin, même en cas d'échec.
    pub async fn task(&self, prompt: &str) -> Result<()> {
        let mut turn = Turn { prompt: prompt.to_string(), summary: String::new(), files: Vec::new(), ok: None, at: conversation::now() };
        let result = self.run_task(prompt, &mut turn).await;
        if let Err(e) = &result {
            turn.summary = format!("{}\n(Interrompu : {e:#})", turn.summary).trim().to_string();
        }
        let _ = Conversation::record(&self.project.root, turn);
        result
    }

    /// `fix` seul (bouton ou `/fix`), enregistré comme un échange de la conversation.
    pub async fn fix_turn(&self, prompt: &str) -> Result<FixOutcome> {
        let out = self.fix().await;
        let summary = match &out {
            Ok(o) if o.ok => format!("{} après {} correctif(s).", o.summary(), o.attempts),
            Ok(o) => format!("{} erreur(s) restantes : {}", o.remaining.len(), o.remaining.iter().take(3).map(|d| d.headline()).collect::<Vec<_>>().join(" ; ")),
            Err(e) => format!("Interrompu : {e:#}"),
        };
        let files = out.as_ref().map(|o| self.snapshot_files(&o.snapshots)).unwrap_or_default();
        let ok = out.as_ref().ok().map(|o| o.ok);
        let _ = Conversation::record(&self.project.root, Turn { prompt: prompt.into(), summary, files, ok, at: conversation::now() });
        out
    }

    fn snapshot_files(&self, ids: &[String]) -> Vec<String> {
        let mut files: Vec<String> = ids.iter().flat_map(|id| Snapshot::files_of(&self.project.root, id)).collect();
        files.sort();
        files.dedup();
        files
    }

    /// Caractères d'historique accordés selon le modèle (un quart du contexte en local).
    fn history_budget(&self, backend: &Backend) -> usize {
        match backend.which() {
            Which::Local => self.cfg.local.context_tokens * 7 / 2 / 4,
            Which::Api => 400_000,
        }
    }

    async fn run_task(&self, prompt: &str, turn: &mut Turn) -> Result<()> {
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
        let mut backend = self.primary()?;
        let mut msgs = Conversation::current(&self.project.root).history(self.history_budget(backend));
        msgs.push(Msg::User(user));
        let fixed_chars = system.len() + serde_json::to_string(&specs).map(|s| s.len()).unwrap_or(0);
        let mut seen: HashMap<String, u32> = HashMap::new();
        let mut finished = false;

        for _ in 0..self.cfg.max_steps {
            // Le contexte d'un modèle local est petit : les vieux résultats d'outils sortent.
            // (Jamais côté API : l'historique déjà envoyé n'y est pas réécrit.)
            if backend.which() == Which::Local {
                let n = conversation::fit(&mut msgs, fixed_chars, self.cfg.local.context_tokens);
                if n > 0 {
                    self.emit(Event::Terminal { line: format!("agent › contexte plein : {n} ancien(s) résultat(s) retiré(s)"), stream: Stream::Agent });
                }
            }
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
                turn.summary = reply.text.trim().to_string();
                self.emit(Event::Text { text: turn.summary.clone() });
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
        turn.files = toolbox.snapshot.lock().unwrap().files.keys().cloned().collect();

        if !finished {
            self.emit(Event::Text { text: format!("Arrêt après {} actions. Relance la tâche pour continuer.", self.cfg.max_steps) });
        }
        if self.cfg.auto_fix && self.ensure_build_cmd().await.is_some() {
            let out = self.fix().await?;
            turn.ok = Some(out.ok);
            turn.files.extend(self.snapshot_files(&out.snapshots));
            turn.files.sort();
            turn.files.dedup();
            self.emit(Event::Done { ok: out.ok, summary: out.summary() });
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
            build_cmd: self.build_cmd(),
        }
    }

    fn save_snapshot(&self, toolbox: &Toolbox) {
        let snap = toolbox.snapshot.lock().unwrap();
        if !snap.files.is_empty() {
            let _ = snap.save(&self.project.root);
        }
    }

    pub fn build_cmd(&self) -> Option<String> {
        self.project.build_command(&self.cfg).or_else(|| self.inferred.lock().unwrap().as_ref()?.build.clone())
    }

    pub fn test_cmd(&self) -> Option<String> {
        self.project.test_command(&self.cfg).or_else(|| self.inferred.lock().unwrap().as_ref()?.test.clone())
    }

    /// Commande de build connue, ou proposée par le modèle et acceptée par
    /// l'utilisateur (puis enregistrée dans la config du projet). C'est ce
    /// qui rend l'agent utilisable avec n'importe quel langage.
    pub async fn ensure_build_cmd(&self) -> Option<String> {
        if let Some(c) = self.build_cmd() {
            return Some(c);
        }
        let id = self.step("recherche des commandes de build");
        let proposed = match self.infer_commands().await {
            Ok(c) if c.build.is_some() => c,
            Ok(_) => {
                self.end(id, "aucune", false);
                return None;
            }
            Err(e) => {
                self.end(id, format!("échec : {e:#}"), false);
                return None;
            }
        };
        self.end(id, "proposées", true);
        let detail = format!(
            "build : {}\ntest  : {}",
            proposed.build.as_deref().unwrap_or("—"),
            proposed.test.as_deref().unwrap_or("—")
        );
        let request = crate::events::ApprovalRequest {
            id: APPROVALS.fetch_add(1, Ordering::Relaxed),
            title: "Utiliser ces commandes pour ce projet ?".into(),
            detail,
            rule: String::new(),
        };
        match self.host.approve(request).await {
            Ok(crate::events::Decision::Allow | crate::events::Decision::AlwaysAllow) => {
                let _ = Config::save_project_commands(&self.project.root, proposed.build.as_deref(), proposed.test.as_deref());
                let build = proposed.build.clone();
                *self.inferred.lock().unwrap() = Some(proposed);
                build
            }
            _ => {
                self.emit(Event::Text { text: "Sans commande de build, je ne peux pas vérifier le code. Tu peux la définir dans les réglages du projet.".into() });
                None
            }
        }
    }

    async fn infer_commands(&self) -> Result<Commands> {
        const SYSTEM: &str = "Tu identifies les commandes d'un projet logiciel. Réponds UNIQUEMENT avec un objet JSON \
            {\"build\": \"…\", \"test\": \"…\"}. `build` compile le projet, ou le vérifie sans l'exécuter si le langage \
            n'est pas compilé (analyse statique, vérification de syntaxe), et affiche les erreurs avec fichier et ligne. \
            `test` lance les tests. Mets null quand rien de raisonnable n'existe. Commandes non interactives, lancées \
            depuis la racine du projet.";
        let root = &self.project.root;
        let mut prompt = format!("Système : {}\n\n{}", std::env::consts::OS, self.context());
        // Les petits fichiers à la racine sont presque toujours des manifestes.
        let mut shown = 0;
        for f in crate::index::walk(root).iter().filter(|p| p.components().count() == 1) {
            let Ok(text) = std::fs::read_to_string(root.join(f)) else { continue };
            if text.len() > 3000 || f.to_string_lossy() == "NOTES.md" {
                continue;
            }
            prompt.push_str(&format!("\n\n## {}\n```\n{}\n```", crate::index::rel(f), text.trim()));
            shown += 1;
            if shown == 6 {
                break;
            }
        }
        let backend = self.escalation().unwrap_or(self.primary()?);
        let reply = self.chat(backend, SYSTEM, &[Msg::User(prompt)], &[]).await?;
        let start = reply.text.find('{').ok_or_else(|| anyhow::anyhow!("réponse sans JSON"))?;
        let end = reply.text.rfind('}').ok_or_else(|| anyhow::anyhow!("réponse sans JSON"))?;
        let mut c: Commands = serde_json::from_str(&reply.text[start..=end])?;
        let clean = |s: Option<String>| s.map(|x| x.trim().to_string()).filter(|x| !x.is_empty() && x != "null");
        c.build = clean(c.build);
        c.test = clean(c.test);
        Ok(c)
    }

    async fn build(&self) -> Result<(bool, Vec<Diagnostic>)> {
        let Some(cmd) = self.build_cmd() else { bail!("pas de commande de build connue") };
        let id = self.step(short_cmd(&cmd));
        let out = self.project.run(&cmd, self.host.as_ref(), Duration::from_secs(600)).await?;
        // Le code de sortie fait foi : un format reconnu à tort dans une
        // sortie réussie ne doit pas inventer d'erreur.
        let ok = out.ok;
        let mut diags = if ok { Vec::new() } else { diag::parse(&out.output) };
        normalize_paths(&mut diags, &self.project.root);
        diags.retain(|d| d.is_error());
        if !ok && diags.is_empty() {
            diags = fallback_diags(&out.output, &self.project.root);
        }
        let errs_shown = diags.len();
        self.end(id, if ok { format!("OK · {:.1} s", out.seconds).replace('.', ",") } else { plural(errs_shown, "erreur") }, ok);
        self.emit(Event::Build { ok, errors: errs_shown, seconds: out.seconds });
        Ok((ok, diags))
    }

    /// Compile et corrige jusqu'à ce que ça passe ou que les tentatives soient épuisées.
    pub async fn fix(&self) -> Result<FixOutcome> {
        if self.ensure_build_cmd().await.is_none() {
            bail!("aucune commande de build pour ce projet : définis-la dans les réglages du projet (build_cmd)");
        }
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
            let mut phase = Phase::Build;

            // Une suggestion incertaine qui n'a rien arrangé est annulée.
            if let Some((snap, before)) = trial.take() {
                if !ok && errors.len() >= before.len() {
                    Snapshot::restore(&root, &snap)?;
                    snapshots.retain(|s| s != &snap);
                    self.emit(Event::Terminal { line: "agent › suggestion du compilateur annulée (sans effet)".into(), stream: Stream::Agent });
                    errors = before;
                }
            }

            // Build vert : au tour des tests.
            if ok {
                match self.cfg.fix_tests.then(|| self.test_cmd()).flatten() {
                    Some(cmd) => {
                        let (tests_ok, failures) = self.run_tests(&cmd).await?;
                        if tests_ok {
                            self.remember(&memory, &mut pending, &[]);
                            return Ok(FixOutcome { ok: true, tests: Some(true), attempts, remaining: vec![], snapshots });
                        }
                        errors = failures;
                        phase = Phase::Tests;
                    }
                    None => {
                        self.remember(&memory, &mut pending, &[]);
                        return Ok(FixOutcome { ok: true, tests: None, attempts, remaining: vec![], snapshots });
                    }
                }
            }

            // Les correctifs qui ont fait disparaître leur erreur vont en mémoire.
            self.remember(&memory, &mut pending, &errors);

            self.emit(Event::Diagnostics { items: errors.clone() });
            let what = if phase == Phase::Tests { "test(s) en échec" } else { "erreur(s) capturée(s)" };
            self.emit(Event::Terminal { line: format!("agent › {} {what}, correction en cours ({})", errors.len(), backend_name(backend)), stream: Stream::Agent });

            // 1. Les suggestions sûres du compilateur, sans modèle.
            if !tried_suggestions && phase == Phase::Build {
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
                    _ => return Ok(FixOutcome { ok: false, tests: None, attempts, remaining: errors, snapshots }),
                }
            }
            attempts += 1;
            backend_attempts += 1;

            let prompt = self.fix_prompt(&errors, &memory, conversation.is_empty(), phase);
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

    /// Les correctifs dont l'erreur a disparu vont dans la mémoire épisodique.
    fn remember(&self, memory: &FixMemory, pending: &mut Vec<(Diagnostic, String, String)>, errors: &[Diagnostic]) {
        for (d, diff, by) in pending.drain(..) {
            if !errors.iter().any(|e| e.code == d.code && e.message == d.message && e.file == d.file) {
                let _ = memory.record(&FixRecord { code: d.code.clone(), message: d.message.clone(), file: d.file.clone(), diff, backend: by });
            }
        }
    }

    async fn run_tests(&self, cmd: &str) -> Result<(bool, Vec<Diagnostic>)> {
        let id = self.step(short_cmd(cmd));
        let out = self.project.run(cmd, self.host.as_ref(), Duration::from_secs(900)).await?;
        let mut failures = if out.ok { Vec::new() } else { diag::parse(&out.output) };
        normalize_paths(&mut failures, &self.project.root);
        failures.retain(|d| d.is_error());
        if !out.ok && failures.is_empty() {
            failures = fallback_diags(&out.output, &self.project.root);
        }
        let n = failures.len();
        self.end(id, if out.ok { format!("OK · {:.1} s", out.seconds).replace('.', ",") } else { plural(n, "échec") }, out.ok);
        self.emit(Event::Tests { ok: out.ok, failures: n, seconds: out.seconds });
        Ok((out.ok, failures))
    }

    /// Fichiers source dont le nom apparaît dans un fichier de test (imports,
    /// `use`, noms de modules) : c'est souvent là qu'est le bug.
    fn related_sources(&self, test_files: &[String], already: &[String]) -> Vec<String> {
        let root = &self.project.root;
        let text: String = test_files.iter().filter_map(|f| std::fs::read_to_string(root.join(f)).ok()).collect::<Vec<_>>().join("\n");
        let words: std::collections::HashSet<&str> = text.split(|c: char| !c.is_alphanumeric() && c != '_').filter(|w| w.len() >= 3).collect();
        let mut out = Vec::new();
        for p in crate::index::walk(root) {
            let rel = crate::index::rel(&p);
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let is_test = stem.contains("test") || stem.contains("spec") || rel.split('/').any(|d| d == "tests" || d == "test");
            if is_test || !crate::project::is_source_ext(ext) || already.contains(&rel) || test_files.contains(&rel) {
                continue;
            }
            // `mod.rs`, `__init__.py`, `index.ts` : c'est le nom du dossier qui compte.
            let name = if matches!(stem, "mod" | "__init__" | "index" | "lib" | "main") {
                p.parent().and_then(|d| d.file_name()).and_then(|n| n.to_str()).unwrap_or(stem)
            } else {
                stem
            };
            if words.contains(name) {
                out.push(rel);
                if out.len() == 2 {
                    break;
                }
            }
        }
        out
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

    fn fix_prompt(&self, errors: &[Diagnostic], memory: &FixMemory, first: bool, phase: Phase) -> String {
        let root = &self.project.root;
        let mut p = String::new();
        if first {
            let notes = Notes::new(root).read();
            if !notes.trim().is_empty() {
                p.push_str(&format!("## NOTES.md\n{}\n\n", notes.trim()));
            }
        } else {
            p.push_str("Ça échoue encore après ta modification.\n\n");
        }
        if phase == Phase::Tests {
            p.push_str(
                "## Tests en échec\nLe build passe mais des tests échouent. Corrige le code testé. Ne modifie un test que s'il \
                 est manifestement faux, et dis-le dans ta phrase d'explication ; ne l'affaiblis jamais pour le faire passer.\n",
            );
        } else {
            p.push_str("## Erreurs\n");
        }
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
        if phase == Phase::Tests {
            for f in self.related_sources(&shown, &shown) {
                let Ok(src) = std::fs::read_to_string(root.join(&f)) else { continue };
                let lines: Vec<&str> = src.lines().collect();
                let b = lines.len().min(250);
                p.push_str(&format!("\n## {f} (code testé, lignes 1-{b} sur {})\n```\n{}\n```\n", lines.len(), lines[..b].join("\n")));
            }
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

/// Chemins des diagnostics rendus relatifs à la racine du projet ; un nom de
/// fichier seul (javac, piles JVM) est retrouvé dans l'arborescence.
fn normalize_paths(diags: &mut [Diagnostic], root: &Path) {
    let mut files: Option<Vec<String>> = None;
    for d in diags.iter_mut().filter(|d| !d.file.is_empty()) {
        if let Some(rel) = resolve(&d.file, root, &mut files) {
            d.file = rel;
        }
    }
}

fn resolve(file: &str, root: &Path, cache: &mut Option<Vec<String>>) -> Option<String> {
    let clean = file.trim_start_matches("./").replace('\\', "/");
    let p = Path::new(&clean);
    if p.is_absolute() {
        return p.strip_prefix(root).ok().map(crate::index::rel);
    }
    if root.join(p).is_file() {
        return Some(clean);
    }
    let files = cache.get_or_insert_with(|| crate::index::walk(root).iter().map(|p| crate::index::rel(p)).collect());
    let suffix = format!("/{clean}");
    let hits: Vec<&String> = files.iter().filter(|f| f.ends_with(&suffix)).collect();
    (hits.len() == 1).then(|| hits[0].clone())
}

/// Sortie d'échec dans un format inconnu : la fin de la sortie comme message,
/// rattachée aux fichiers du projet qu'elle cite.
fn fallback_diags(output: &str, root: &Path) -> Vec<Diagnostic> {
    let tail: Vec<&str> = output.lines().rev().take(30).collect();
    let message = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
    let mut cache = None;
    let mut out: Vec<Diagnostic> = Vec::new();
    for (file, line) in diag::mentions(output) {
        let Some(rel) = resolve(&file, root, &mut cache) else { continue };
        if out.iter().any(|d| d.file == rel) {
            continue;
        }
        let message = if out.is_empty() { message.clone() } else { "(fichier cité dans la sortie)".into() };
        out.push(Diagnostic { file: rel, line, column: 1, level: diag::Level::Error, code: None, message, notes: vec![], suggestions: vec![] });
        if out.len() == 3 {
            break;
        }
    }
    if out.is_empty() {
        out.push(Diagnostic { file: String::new(), line: 0, column: 0, level: diag::Level::Error, code: None, message, notes: vec![], suggestions: vec![] });
    }
    out
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
