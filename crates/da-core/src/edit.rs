//! Modifications de fichiers : blocs SEARCH/REPLACE produits par le modèle,
//! suggestions du compilateur, et instantanés pour « Annuler ce correctif ».
//!
//! Le format SEARCH/REPLACE est volontairement textuel : un modèle de 7-14B le
//! produit bien plus fiablement qu'un diff unifié ou un appel d'outil imbriqué.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::diag::Suggestion;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditBlock {
    pub file: String,
    pub search: String,
    pub replace: String,
}

/// Extrait les blocs :
///
/// ```text
/// src/config.rs
/// <<<<<<< SEARCH
/// timeout: raw.timeout,
/// =======
/// timeout: raw.timeout.as_secs() as u32,
/// >>>>>>> REPLACE
/// ```
///
/// Le nom de fichier est la dernière ligne non vide avant `<<<<<<< SEARCH`
/// (on tolère les clôtures ``` et les puces que les modèles ajoutent).
pub fn parse_blocks(text: &str) -> Vec<EditBlock> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if !lines[i].trim_start().starts_with("<<<<<<< SEARCH") {
            i += 1;
            continue;
        }
        let file = lines[..i]
            .iter()
            .rev()
            .map(|l| clean_filename(l))
            .find(|l| !l.is_empty())
            .unwrap_or_default();
        let (mut search, mut replace) = (Vec::new(), Vec::new());
        let mut j = i + 1;
        while j < lines.len() && lines[j].trim() != "=======" {
            search.push(lines[j]);
            j += 1;
        }
        j += 1;
        while j < lines.len() && !lines[j].trim_start().starts_with(">>>>>>> REPLACE") {
            replace.push(lines[j]);
            j += 1;
        }
        if j < lines.len() && !file.is_empty() {
            out.push(EditBlock { file, search: search.join("\n"), replace: replace.join("\n") });
        }
        i = j + 1;
    }
    out
}

fn clean_filename(line: &str) -> String {
    let l = line.trim().trim_start_matches(['-', '*', '#', ' ']).trim();
    if l.starts_with("```") {
        // ```rust ou ``` seul : pas un nom de fichier.
        return String::new();
    }
    l.trim_matches(['`', '*', ':']).trim().to_string()
}

/// Applique un remplacement dans `content`. Correspondance exacte d'abord,
/// puis en ignorant l'indentation et les espaces de fin (les petits modèles
/// réindentent souvent). La recherche doit être unique.
pub fn apply_block(content: &str, search: &str, replace: &str) -> Result<String> {
    if search.trim().is_empty() {
        // Bloc de création/ajout.
        let mut s = content.to_string();
        if !s.is_empty() && !s.ends_with('\n') {
            s.push('\n');
        }
        s.push_str(replace);
        s.push('\n');
        return Ok(s);
    }
    match content.matches(search).count() {
        1 => return Ok(content.replacen(search, replace, 1)),
        n if n > 1 => bail!("le passage SEARCH apparaît {n} fois, ajoute du contexte"),
        _ => {}
    }
    // Comparaison ligne à ligne, espaces normalisés.
    let hay: Vec<&str> = content.lines().collect();
    let needle: Vec<&str> = search.lines().filter(|l| !l.trim().is_empty()).collect();
    let norm = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut hits = Vec::new();
    'outer: for start in 0..hay.len() {
        let (mut h, mut n) = (start, 0);
        while n < needle.len() {
            if h >= hay.len() {
                continue 'outer;
            }
            if hay[h].trim().is_empty() && h != start {
                h += 1;
                continue;
            }
            if norm(hay[h]) != norm(needle[n]) {
                continue 'outer;
            }
            h += 1;
            n += 1;
        }
        hits.push((start, h));
    }
    let (start, end) = match hits.as_slice() {
        [one] => *one,
        [] => bail!("passage SEARCH introuvable"),
        _ => bail!("le passage SEARCH apparaît {} fois, ajoute du contexte", hits.len()),
    };
    // On garde l'indentation d'origine de la première ligne remplacée.
    let indent: String = hay[start].chars().take_while(|c| c.is_whitespace()).collect();
    let model_indent: String = needle[0].chars().take_while(|c| c.is_whitespace()).collect();
    let mut out: Vec<String> = hay[..start].iter().map(|s| s.to_string()).collect();
    for l in replace.lines() {
        let body = l.strip_prefix(model_indent.as_str()).unwrap_or(l.trim_start());
        out.push(if l.trim().is_empty() { String::new() } else { format!("{indent}{body}") });
    }
    out.extend(hay[end..].iter().map(|s| s.to_string()));
    let mut s = out.join("\n");
    if content.ends_with('\n') {
        s.push('\n');
    }
    Ok(s)
}

/// Applique une suggestion du compilateur (lignes/colonnes 1-based, colonnes en caractères).
pub fn apply_suggestion(content: &str, s: &Suggestion) -> Result<String> {
    let offset = |line: u32, col: u32| -> Option<usize> {
        let mut pos = 0;
        for (i, l) in content.split_inclusive('\n').enumerate() {
            if i + 1 == line as usize {
                let byte = l.char_indices().nth(col.saturating_sub(1) as usize).map(|(b, _)| b).unwrap_or(l.len());
                return Some(pos + byte);
            }
            pos += l.len();
        }
        (line as usize == content.lines().count() + 1).then_some(content.len())
    };
    let a = offset(s.line_start, s.col_start).ok_or_else(|| anyhow!("position hors fichier"))?;
    let b = offset(s.line_end, s.col_end).ok_or_else(|| anyhow!("position hors fichier"))?;
    if b < a {
        bail!("plage inversée");
    }
    Ok(format!("{}{}{}", &content[..a], s.replacement, &content[b..]))
}

/// Diff unifié court pour le panneau Correction.
pub fn unified_diff(path: &str, before: &str, after: &str) -> String {
    similar::TextDiff::from_lines(before, after)
        .unified_diff()
        .context_radius(2)
        .header(path, path)
        .to_string()
}

/// Copie des fichiers avant un correctif, rangée dans `.digital-arms/snapshots/<id>.json`.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: String,
    /// chemin relatif → contenu d'origine (`None` = le fichier n'existait pas).
    pub files: BTreeMap<String, Option<String>>,
}

impl Snapshot {
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into(), files: BTreeMap::new() }
    }

    /// Mémorise l'état d'origine d'un fichier (une seule fois par instantané).
    pub fn remember(&mut self, root: &Path, rel: &str) {
        if !self.files.contains_key(rel) {
            self.files.insert(rel.to_string(), std::fs::read_to_string(root.join(rel)).ok());
        }
    }

    fn path(root: &Path, id: &str) -> PathBuf {
        root.join(crate::Config::DIR).join("snapshots").join(format!("{id}.json"))
    }

    pub fn save(&self, root: &Path) -> Result<()> {
        let p = Self::path(root, &self.id);
        std::fs::create_dir_all(p.parent().unwrap())?;
        std::fs::write(p, serde_json::to_string(self)?)?;
        Ok(())
    }

    /// Fichiers touchés par un instantané enregistré.
    pub fn files_of(root: &Path, id: &str) -> Vec<String> {
        std::fs::read_to_string(Self::path(root, id))
            .ok()
            .and_then(|t| serde_json::from_str::<Snapshot>(&t).ok())
            .map(|s| s.files.into_keys().collect())
            .unwrap_or_default()
    }

    /// Remet les fichiers dans leur état d'avant le correctif.
    pub fn restore(root: &Path, id: &str) -> Result<Vec<String>> {
        let text = std::fs::read_to_string(Self::path(root, id)).with_context(|| format!("instantané {id} introuvable"))?;
        let snap: Snapshot = serde_json::from_str(&text)?;
        for (rel, content) in &snap.files {
            let p = root.join(rel);
            match content {
                Some(c) => std::fs::write(&p, c)?,
                None => {
                    let _ = std::fs::remove_file(&p);
                }
            }
        }
        Ok(snap.files.into_keys().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_blocks_with_fences() {
        let t = "Voici le correctif :\n\n`src/config.rs`\n```rust\n<<<<<<< SEARCH\n    timeout: raw.timeout,\n=======\n    timeout: raw.timeout.as_secs() as u32,\n>>>>>>> REPLACE\n```\n";
        let b = parse_blocks(t);
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].file, "src/config.rs");
        assert_eq!(b[0].search, "    timeout: raw.timeout,");
    }

    #[test]
    fn exact_then_fuzzy() {
        let src = "fn a() {\n    let x = 1;\n    let y = 2;\n}\n";
        assert_eq!(apply_block(src, "let x = 1;", "let x = 3;").unwrap(), "fn a() {\n    let x = 3;\n    let y = 2;\n}\n");
        // Le modèle a perdu l'indentation et ajouté des espaces.
        let out = apply_block(src, "let x = 1;\nlet y  = 2;", "let x = 1;\nlet y = 5;").unwrap();
        assert_eq!(out, "fn a() {\n    let x = 1;\n    let y = 5;\n}\n");
    }

    #[test]
    fn ambiguous_search_is_rejected() {
        assert!(apply_block("a\nb\na\n", "a", "c").is_err());
        assert!(apply_block("a\n", "zzz", "c").is_err());
    }

    #[test]
    fn suggestion_replaces_span() {
        let s = Suggestion {
            message: String::new(),
            file: "x".into(),
            line_start: 2,
            col_start: 9,
            line_end: 2,
            col_end: 15,
            replacement: "_unused".into(),
            machine_applicable: true,
        };
        assert_eq!(apply_suggestion("fn m() {\n    let unused = 1;\n}\n", &s).unwrap(), "fn m() {\n    let _unused = 1;\n}\n");
    }
}
