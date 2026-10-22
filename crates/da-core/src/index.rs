//! Index structurel (couche 1) : arborescence, symboles tree-sitter et
//! recherche exacte. Aucun modèle, instantané, et couvre l'essentiel des
//! besoins d'un agent de code (« où est définie `parse_config` ? »).

use std::path::{Path, PathBuf};

use anyhow::Result;
use regex::RegexBuilder;
use serde::Serialize;
use tree_sitter::{Language, Node, Parser};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Symbol {
    pub name: String,
    pub kind: &'static str,
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub file: String,
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Default, Serialize)]
pub struct Index {
    pub files: Vec<String>,
    pub symbols: Vec<Symbol>,
}

const MAX_FILE: u64 = 512 * 1024;

/// Fichiers du projet en respectant `.gitignore` (chemins relatifs, `/`).
pub fn walk(root: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = ignore::WalkBuilder::new(root)
        .hidden(true)
        .filter_entry(|e| !matches!(e.file_name().to_str(), Some("target" | "build" | "node_modules" | ".venv" | "__pycache__")))
        .build()
        .flatten()
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .filter(|e| e.metadata().is_ok_and(|m| m.len() <= MAX_FILE))
        .filter_map(|e| e.path().strip_prefix(root).ok().map(Path::to_path_buf))
        .collect();
    v.sort();
    v
}

pub fn rel(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn language(path: &Path) -> Option<Language> {
    Some(match path.extension()?.to_str()? {
        "rs" => tree_sitter_rust::LANGUAGE.into(),
        "py" | "pyi" => tree_sitter_python::LANGUAGE.into(),
        "cpp" | "cc" | "cxx" | "hpp" | "hh" | "hxx" | "h" | "c" => tree_sitter_cpp::LANGUAGE.into(),
        _ => return None,
    })
}

impl Index {
    pub fn build(root: &Path) -> Result<Self> {
        let mut idx = Index::default();
        let mut parser = Parser::new();
        for path in walk(root) {
            let name = rel(&path);
            if let Some(lang) = language(&path) {
                if let Ok(src) = std::fs::read_to_string(root.join(&path)) {
                    idx.symbols.extend(symbols_in(&mut parser, lang, &src, &name));
                }
            }
            idx.files.push(name);
        }
        Ok(idx)
    }

    /// Symboles dont le nom contient `query` (insensible à la casse), exacts d'abord.
    pub fn find(&self, query: &str) -> Vec<&Symbol> {
        let q = query.to_lowercase();
        let mut v: Vec<&Symbol> = self.symbols.iter().filter(|s| s.name.to_lowercase().contains(&q)).collect();
        v.sort_by_key(|s| (s.name.to_lowercase() != q, s.name.len()));
        v.truncate(30);
        v
    }

    /// Plan d'un fichier : ses symboles, pour décider quoi lire.
    pub fn outline(&self, file: &str) -> Vec<&Symbol> {
        self.symbols.iter().filter(|s| s.file == file).collect()
    }
}

pub fn symbols_in(parser: &mut Parser, lang: Language, src: &str, file: &str) -> Vec<Symbol> {
    if parser.set_language(&lang).is_err() {
        return Vec::new();
    }
    let Some(tree) = parser.parse(src, None) else { return Vec::new() };
    let mut out = Vec::new();
    visit(tree.root_node(), src, file, &mut out);
    out
}

fn visit(node: Node, src: &str, file: &str, out: &mut Vec<Symbol>) {
    let kind = match node.kind() {
        "function_item" | "function_signature_item" => Some("fn"),
        "struct_item" | "struct_specifier" => Some("struct"),
        "enum_item" | "enum_specifier" => Some("enum"),
        "trait_item" => Some("trait"),
        "impl_item" => Some("impl"),
        "mod_item" | "namespace_definition" => Some("mod"),
        "type_item" | "type_definition" | "alias_declaration" => Some("type"),
        "const_item" | "static_item" => Some("const"),
        "macro_definition" => Some("macro"),
        "function_definition" => Some("fn"),
        "class_definition" | "class_specifier" => Some("class"),
        _ => None,
    };
    if let Some(kind) = kind {
        if let Some(name) = name_of(node, src) {
            out.push(Symbol { name, kind, file: file.to_string(), line: node.start_position().row as u32 + 1 });
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        visit(child, src, file, out);
    }
}

fn name_of(node: Node, src: &str) -> Option<String> {
    let text = |n: Node| n.utf8_text(src.as_bytes()).ok().map(str::to_string);
    if node.kind() == "impl_item" {
        let ty = text(node.child_by_field_name("type")?)?;
        return Some(match node.child_by_field_name("trait").and_then(text) {
            Some(tr) => format!("{tr} for {ty}"),
            None => ty,
        });
    }
    if let Some(n) = node.child_by_field_name("name") {
        return text(n);
    }
    // C++ : le nom d'une fonction est caché dans son déclarateur.
    let mut decl = node.child_by_field_name("declarator")?;
    loop {
        match decl.kind() {
            "identifier" | "field_identifier" | "qualified_identifier" | "destructor_name" | "operator_name" | "type_identifier" => {
                return text(decl)
            }
            _ => decl = decl.child_by_field_name("declarator")?,
        }
    }
}

/// Recherche texte façon ripgrep (regex, insensible à la casse si tout est en minuscules).
pub fn search(root: &Path, pattern: &str, max: usize) -> Result<Vec<Hit>> {
    let re = RegexBuilder::new(pattern)
        .case_insensitive(pattern.chars().all(|c| !c.is_uppercase()))
        .build()
        .or_else(|_| RegexBuilder::new(&regex::escape(pattern)).build())?;
    let mut hits = Vec::new();
    for path in walk(root) {
        let Ok(src) = std::fs::read_to_string(root.join(&path)) else { continue };
        for (i, line) in src.lines().enumerate() {
            if re.is_match(line) {
                hits.push(Hit { file: rel(&path), line: i as u32 + 1, text: line.trim().chars().take(200).collect() });
                if hits.len() >= max {
                    return Ok(hits);
                }
            }
        }
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn syms(path: &str, src: &str) -> Vec<(String, &'static str)> {
        let lang = language(Path::new(path)).unwrap();
        symbols_in(&mut Parser::new(), lang, src, path).into_iter().map(|s| (s.name, s.kind)).collect()
    }

    #[test]
    fn rust_symbols() {
        let s = syms("a.rs", "pub struct Config { t: u32 }\nimpl Config { pub fn load() {} }\nimpl Default for Config { fn default() -> Self { todo!() } }\nmod net { fn connect() {} }");
        for want in [("Config", "struct"), ("Config", "impl"), ("load", "fn"), ("Default for Config", "impl"), ("net", "mod"), ("connect", "fn")] {
            assert!(s.contains(&(want.0.to_string(), want.1)), "{want:?} absent de {s:?}");
        }
    }

    #[test]
    fn python_and_cpp_symbols() {
        let s = syms("a.py", "class Parser:\n    def parse(self):\n        pass\n\ndef main():\n    pass\n");
        assert_eq!(s, vec![("Parser".into(), "class"), ("parse".into(), "fn"), ("main".into(), "fn")]);
        let s = syms("a.cpp", "namespace sim { struct Body {}; int step(Body& b) { return 0; } }\nint Engine::run() { return 1; }\n");
        for want in [("sim", "mod"), ("Body", "struct"), ("step", "fn"), ("Engine::run", "fn")] {
            assert!(s.contains(&(want.0.to_string(), want.1)), "{want:?} absent de {s:?}");
        }
    }

    #[test]
    fn search_respects_gitignore() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("target")).unwrap();
        std::fs::write(tmp.path().join("target/x.rs"), "fn reconnect() {}").unwrap();
        std::fs::write(tmp.path().join("lib.rs"), "fn reconnect() {}").unwrap();
        let hits = search(tmp.path(), "reconnect", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].file, "lib.rs");
    }
}
