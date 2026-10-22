//! Moteur de Digital Arms.
//!
//! Tout ce qui ne dépend pas de l'interface vit ici : clients LLM (local
//! compatible OpenAI, API Anthropic), lecture des diagnostics de compilateurs,
//! outils de l'agent, index structurel, mémoire de projet et boucle de
//! correction. Le shell Tauri et le CLI ne font que brancher un [`events::Host`].

pub mod agent;
pub mod config;
pub mod conversation;
pub mod diag;
pub mod edit;
pub mod events;
pub mod index;
pub mod llm;
pub mod memory;
pub mod permissions;
pub mod project;
pub mod setup;
pub mod tools;

pub use agent::Agent;
pub use config::{Config, Mode};
pub use events::{Decision, Event, Host};
pub use project::Project;
