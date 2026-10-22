use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use crate::diag::Diagnostic;

/// Ce que l'agent raconte à l'interface. Sérialisé tel quel vers la webview.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// Texte du modèle destiné à l'utilisateur.
    Text { text: String },
    /// Une action compacte (« cargo build », « lecture src/x.rs:1-40 »…).
    StepStart { id: u64, label: String },
    StepEnd { id: u64, summary: String, ok: bool },
    /// Sortie brute d'une commande, pour le terminal partagé.
    Terminal { line: String, stream: Stream },
    /// Erreurs parsées après un build.
    Diagnostics { items: Vec<Diagnostic> },
    /// Un correctif vient d'être appliqué.
    Patch { snapshot: String, file: String, diff: String, attempt: u32, backend: String },
    /// Résultat d'un build.
    Build { ok: bool, errors: usize, seconds: f32 },
    /// Résultat des tests (lancés quand le build passe).
    Tests { ok: bool, failures: usize, seconds: f32 },
    /// La boucle de correction passe à l'API.
    Escalated { reason: String },
    /// Fin de tâche.
    Done { ok: bool, summary: String },
    /// Compteurs pour la barre d'état.
    Usage { backend: String, calls: u32 },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stdout,
    Stderr,
    Agent,
}

/// Une question posée à l'utilisateur (installer une dépendance, écrire un fichier…).
#[derive(Debug, Clone, Serialize)]
pub struct ApprovalRequest {
    pub id: u64,
    pub title: String,
    pub detail: String,
    /// Clé mémorisée si l'utilisateur répond « toujours pour ce projet ».
    pub rule: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Allow,
    Deny,
    AlwaysAllow,
}

/// Branché par le CLI ou par Tauri.
pub trait Host: Send + Sync {
    fn emit(&self, event: Event);
    /// Doit répondre tôt ou tard ; un canal fermé vaut un refus.
    fn approve(&self, request: ApprovalRequest) -> oneshot::Receiver<Decision>;
}

/// Hôte muet, pratique pour les tests : tout est autorisé.
pub struct NullHost;

impl Host for NullHost {
    fn emit(&self, _event: Event) {}
    fn approve(&self, _request: ApprovalRequest) -> oneshot::Receiver<Decision> {
        let (tx, rx) = oneshot::channel();
        let _ = tx.send(Decision::Allow);
        rx
    }
}
