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
