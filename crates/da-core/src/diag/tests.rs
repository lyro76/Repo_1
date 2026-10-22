use super::*;

const CARGO: &str = include_str!("../../tests/fixtures/cargo.jsonl");
const CARGO_SUGGEST: &str = include_str!("../../tests/fixtures/cargo_suggest.jsonl");
const GCC_TEXT: &str = include_str!("../../tests/fixtures/gcc.txt");
const GCC_JSON: &str = include_str!("../../tests/fixtures/gcc.json");
const PY_TB: &str = include_str!("../../tests/fixtures/py_traceback.txt");
const PY_SYN: &str = include_str!("../../tests/fixtures/py_syntax.txt");

#[test]
fn cargo_json() {
    let d = parse(CARGO);
    let err = d.iter().find(|d| d.is_error()).expect("une erreur");
    assert_eq!(err.code.as_deref(), Some("E0308"));
    assert_eq!(err.file, "src/main.rs");
    assert_eq!(err.line, 5);
    assert!(err.message.contains("mismatched types"));
    assert_eq!(err.notes[0], "expected `u32`, found `Duration`");
}

#[test]
fn cargo_suggestion() {
    let d = parse(CARGO_SUGGEST);
    let s = &d[0].suggestions[0];
    assert_eq!((s.line_start, s.col_start, s.col_end), (2, 26, 26));
    assert_eq!(s.replacement, ".to_string()");
    assert!(!s.machine_applicable);
}

#[test]
fn gcc_text_and_json_agree() {
    for out in [GCC_TEXT, GCC_JSON] {
        let d = parse(out);
        let errs = errors(&d);
        assert_eq!(errs.len(), 2, "{out}");
        assert_eq!((errs[0].file.as_str(), errs[0].line, errs[0].column), ("a.cpp", 1, 21));
        assert!(errs[1].message.contains("'y' was not declared"));
    }
    assert_eq!(parse(GCC_TEXT)[0].code.as_deref(), Some("-fpermissive"));
}

#[test]
fn python_traceback_points_to_innermost_frame() {
    let d = parse(PY_TB);
    assert_eq!(d.len(), 1);
    assert_eq!((d[0].file.as_str(), d[0].line), ("t.py", 2));
    assert_eq!(d[0].code.as_deref(), Some("NameError"));
    assert_eq!(d[0].message, "name 'bar' is not defined");
}

#[test]
fn python_syntax_error() {
    let d = parse(PY_SYN);
    assert_eq!(d.len(), 1);
    assert_eq!((d[0].file.as_str(), d[0].line), ("s.py", 1));
    assert_eq!(d[0].code.as_deref(), Some("SyntaxError"));
}

#[test]
fn pytest_failure() {
    let out = "    def test_add():\n>       assert add(1, 2) == 4\nE       assert 3 == 4\nE        +  where 3 = add(1, 2)\n\ntests/test_calc.py:4: AssertionError\n";
    let d = parse(out);
    assert_eq!(d.len(), 1);
    assert_eq!((d[0].file.as_str(), d[0].line), ("tests/test_calc.py", 4));
    assert!(d[0].message.contains("assert 3 == 4"));
}

#[test]
fn mypy_style() {
    let d = parse("src/app.py:10: error: Incompatible return value type  [return-value]\n");
    assert_eq!(d[0].line, 10);
    assert_eq!(d[0].code.as_deref(), Some("return-value"));
}

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn first_error(name: &str) -> Diagnostic {
    parse(&fixture(name)).into_iter().find(|d| d.is_error()).unwrap_or_else(|| panic!("aucune erreur dans {name}"))
}

#[test]
fn go_build() {
    let d = parse(&fixture("go_build.txt"));
    assert_eq!(errors(&d).len(), 3);
    assert_eq!((d[2].file.as_str(), d[2].line, d[2].column), ("./main.go", 7, 14));
    assert_eq!(d[2].message, "undefined: y");
}

#[test]
fn go_test_failure() {
    let d = first_error("go_test.txt");
    assert_eq!((d.file.as_str(), d.line), ("calc_test.go", 7));
    assert!(d.message.contains("want 3"));
}

#[test]
fn typescript_tsc() {
    let d = parse(&fixture("tsc.txt"));
    assert_eq!(d.len(), 2);
    assert_eq!((d[0].file.as_str(), d[0].line, d[0].column), ("app.ts", 1, 7));
    assert_eq!(d[0].code.as_deref(), Some("TS2322"));
    // Même format que MSBuild (C#) : `Program.cs(12,5): error CS1002: ; expected [app.csproj]`.
    let cs = parse("Program.cs(12,5): error CS1002: ; expected [/p/app.csproj]");
    assert_eq!((cs[0].file.as_str(), cs[0].line, cs[0].code.as_deref(), cs[0].message.as_str()), ("Program.cs", 12, Some("CS1002"), "; expected"));
}

#[test]
fn node_runtime_error_skips_internal_frames() {
    let d = first_error("node.txt");
    assert_eq!((d.file.as_str(), d.line, d.column), ("/projet/app.js", 2, 3));
    assert_eq!(d.code.as_deref(), Some("ReferenceError"));
    assert_eq!(d.message, "bar is not defined");
}

#[test]
fn java_compile_and_runtime() {
    let d = first_error("javac.txt");
    assert_eq!((d.file.as_str(), d.line), ("Main.java", 3));
    let d = first_error("java_run.txt");
    assert_eq!((d.file.as_str(), d.line), ("Boom.java", 4));
    assert_eq!(d.code.as_deref(), Some("NullPointerException"));
}

#[test]
fn ruby_and_php() {
    let d = first_error("ruby.txt");
    assert_eq!((d.file.as_str(), d.line, d.code.as_deref()), ("app.rb", 2, Some("NameError")));
    let d = first_error("php.txt");
    assert_eq!((d.file.as_str(), d.line), ("/projet/app.php", 3));
    assert!(d.message.contains("syntax error"));
}

#[test]
fn rust_test_panic() {
    let d = first_error("cargo_test.txt");
    assert_eq!((d.file.as_str(), d.line, d.column), ("src/lib.rs", 7, 9));
    assert!(d.message.contains("left: -1"), "{}", d.message);
}

#[test]
fn mentions_find_paths_in_any_output() {
    let m = mentions("Error at lib/parser.lua:42: bad token\n  File \"tools/gen.py\", line 7\n");
    assert!(m.contains(&("lib/parser.lua".to_string(), 42)));
    assert!(m.contains(&("tools/gen.py".to_string(), 7)));
}
