//! `oc_edit` — native exact string replacement with uniqueness at parity with
//! `packages/core/src/tool/edit.ts` (FR3, FR18, C4, AC4).
//!
//! Mirrors the reference exactly: `oldString == newString` and an empty `oldString`
//! are rejected with the identical messages; the file's dominant line ending is
//! detected and the search/replacement strings are converted to it before matching;
//! zero occurrences yield `no_match`, more than one without `replace_all` yields
//! `ambiguous_match`, and `replace_all` substitutes every exact occurrence. The write
//! is atomic and preserves a UTF-8 BOM, and the result reports the substitution count.

use std::path::Path;

use opencode_ffi_abi::{FfiError, FfiErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::write::atomic_write_bytes;

/// `oc_edit` request — mirrors `ffi.tools.#EditRequest`.
#[derive(Deserialize)]
pub struct EditRequest {
    pub path: String,
    pub old_string: String,
    pub new_string: String,
    #[serde(default)]
    pub replace_all: bool,
}

/// `oc_edit` result — mirrors `ffi.tools.#EditResult`.
#[derive(Serialize, Deserialize, Debug)]
pub struct EditResult {
    pub replacements: u64,
}

/// The three UTF-8 BOM bytes.
const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

/// Decode UTF-8, stripping a leading 3-byte BOM, mirroring `decodeUtf8` in the
/// reference. Returns the decoded text and whether a BOM was present.
fn decode_utf8(path: &str, bytes: &[u8]) -> Result<(String, bool), FfiError> {
    let (body, bom) = if bytes.len() >= 3 && bytes[..3] == UTF8_BOM {
        (&bytes[3..], true)
    } else {
        (bytes, false)
    };
    std::str::from_utf8(body)
        .map(|s| (s.to_string(), bom))
        .map_err(|_| {
            FfiError::new(
                FfiErrorCode::MalformedUtf8,
                format!("File is not valid UTF-8: {path}"),
            )
        })
}

/// `"\r\n"` when the text contains any CRLF, else `"\n"` (`detectLineEnding`).
fn detect_line_ending(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

/// Normalize CRLF to LF (`normalizeLineEndings`).
fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n")
}

/// Convert `text` to the target ending, mirroring `convertToLineEnding`: normalize to
/// LF first, then expand to CRLF when the target is CRLF.
fn convert_to_line_ending(text: &str, ending: &str) -> String {
    let lf = normalize_line_endings(text);
    if ending == "\n" {
        lf
    } else {
        lf.replace('\n', "\r\n")
    }
}

/// Count non-overlapping occurrences of `search` in `content`, mirroring
/// `countOccurrences` (empty search returns `content.len() + 1`, unreachable here).
fn count_occurrences(content: &str, search: &str) -> usize {
    if search.is_empty() {
        return content.chars().count() + 1;
    }
    let mut count = 0usize;
    let mut offset = 0usize;
    while let Some(found) = content[offset..].find(search) {
        count += 1;
        offset += found + search.len();
    }
    count
}

/// Replace the first occurrence of `search` with `replacement` (mirrors `String#replace`).
fn replace_first(content: &str, search: &str, replacement: &str) -> String {
    match content.find(search) {
        Some(index) => {
            let mut out = String::with_capacity(content.len());
            out.push_str(&content[..index]);
            out.push_str(replacement);
            out.push_str(&content[index + search.len()..]);
            out
        }
        None => content.to_string(),
    }
}

fn no_changes() -> FfiError {
    FfiError::new(
        FfiErrorCode::InvalidRequest,
        "No changes to apply: oldString and newString are identical.",
    )
}

fn empty_old() -> FfiError {
    FfiError::new(
        FfiErrorCode::InvalidRequest,
        "oldString must not be empty. Use write to create or overwrite a file.",
    )
}

/// Perform an exact-string edit at parity with the reference and produce `#EditResult`.
pub fn edit(req: EditRequest) -> Result<Value, FfiError> {
    if req.old_string == req.new_string {
        return Err(no_changes());
    }
    if req.old_string.is_empty() {
        return Err(empty_old());
    }

    let bytes = std::fs::read(&req.path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => FfiError::new(
            FfiErrorCode::NotFound,
            format!("File not found: {}", req.path),
        ),
        _ => FfiError::new(FfiErrorCode::IoError, format!("{err}")),
    })?;
    let (text, bom) = decode_utf8(&req.path, &bytes)?;

    let ending = detect_line_ending(&text);
    let old_string = convert_to_line_ending(&req.old_string, ending);
    let new_string = convert_to_line_ending(&req.new_string, ending);

    let replacements = count_occurrences(&text, &old_string);
    if replacements == 0 {
        return Err(FfiError::new(
            FfiErrorCode::NoMatch,
            "Could not find oldString in the file. It must match exactly, including whitespace and indentation.",
        ));
    }
    if replacements > 1 && !req.replace_all {
        return Err(FfiError::new(
            FfiErrorCode::AmbiguousMatch,
            "Found multiple exact matches for oldString. Provide more surrounding context or set replaceAll to true.",
        ));
    }

    let replaced = if req.replace_all {
        text.replace(&old_string, &new_string)
    } else {
        replace_first(&text, &old_string, &new_string)
    };

    // Preserve a leading BOM exactly as the reference does (source.bom || next.bom).
    let stripped = replaced.trim_start_matches('\u{FEFF}');
    let next_bom = stripped.len() != replaced.len();
    let mut out = String::new();
    if bom || next_bom {
        out.push('\u{FEFF}');
    }
    out.push_str(stripped);

    atomic_write_bytes(Path::new(&req.path), out.as_bytes())?;

    Ok(serde_json::to_value(EditResult {
        replacements: replacements as u64,
    })
    .expect("edit result serializes"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str, body: &[u8]) -> String {
        let mut path = std::env::temp_dir();
        path.push(format!("oc_edit_{}_{}", std::process::id(), name));
        std::fs::write(&path, body).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn edit_ok(req: EditRequest) -> (EditResult, String) {
        let path = req.path.clone();
        let out: EditResult = serde_json::from_value(edit(req).unwrap()).unwrap();
        (out, std::fs::read_to_string(&path).unwrap())
    }

    #[test]
    fn single_match_replaces_and_reports_one() {
        let path = temp_file("single.txt", b"alpha beta gamma\n");
        let (out, body) = edit_ok(EditRequest {
            path,
            old_string: "beta".into(),
            new_string: "BETA".into(),
            replace_all: false,
        });
        assert_eq!(out.replacements, 1);
        assert_eq!(body, "alpha BETA gamma\n");
    }

    #[test]
    fn zero_matches_yields_no_match() {
        let path = temp_file("zero.txt", b"nothing here\n");
        let err = edit(EditRequest {
            path,
            old_string: "absent".into(),
            new_string: "x".into(),
            replace_all: false,
        })
        .unwrap_err();
        assert_eq!(err.code, FfiErrorCode::NoMatch);
        assert_eq!(
            err.message,
            "Could not find oldString in the file. It must match exactly, including whitespace and indentation."
        );
    }

    #[test]
    fn multiple_matches_without_replace_all_is_ambiguous() {
        let path = temp_file("many.txt", b"dup dup dup\n");
        let err = edit(EditRequest {
            path,
            old_string: "dup".into(),
            new_string: "x".into(),
            replace_all: false,
        })
        .unwrap_err();
        assert_eq!(err.code, FfiErrorCode::AmbiguousMatch);
        assert_eq!(
            err.message,
            "Found multiple exact matches for oldString. Provide more surrounding context or set replaceAll to true."
        );
    }

    #[test]
    fn replace_all_substitutes_every_occurrence() {
        let path = temp_file("all.txt", b"dup dup dup\n");
        let (out, body) = edit_ok(EditRequest {
            path,
            old_string: "dup".into(),
            new_string: "x".into(),
            replace_all: true,
        });
        assert_eq!(out.replacements, 3);
        assert_eq!(body, "x x x\n");
    }

    #[test]
    fn identical_old_and_new_is_rejected() {
        let path = temp_file("identical.txt", b"same\n");
        let err = edit(EditRequest {
            path,
            old_string: "same".into(),
            new_string: "same".into(),
            replace_all: false,
        })
        .unwrap_err();
        assert_eq!(err.code, FfiErrorCode::InvalidRequest);
        assert_eq!(
            err.message,
            "No changes to apply: oldString and newString are identical."
        );
    }

    #[test]
    fn empty_old_string_is_rejected() {
        let path = temp_file("empty.txt", b"body\n");
        let err = edit(EditRequest {
            path,
            old_string: String::new(),
            new_string: "x".into(),
            replace_all: false,
        })
        .unwrap_err();
        assert_eq!(err.code, FfiErrorCode::InvalidRequest);
        assert_eq!(
            err.message,
            "oldString must not be empty. Use write to create or overwrite a file."
        );
    }

    #[test]
    fn crlf_file_matches_lf_input_and_writes_crlf() {
        let path = temp_file("crlf.txt", b"one\r\ntwo\r\nthree\r\n");
        let (out, body) = edit_ok(EditRequest {
            path,
            old_string: "one\ntwo".into(),
            new_string: "1\n2".into(),
            replace_all: false,
        });
        assert_eq!(out.replacements, 1);
        assert_eq!(body, "1\r\n2\r\nthree\r\n");
    }

    #[test]
    fn preserves_a_utf8_bom() {
        let path = temp_file("bom.txt", &[&UTF8_BOM[..], b"keep me\n"].concat());
        let (_out, _) = edit_ok(EditRequest {
            path: path.clone(),
            old_string: "keep".into(),
            new_string: "hold".into(),
            replace_all: false,
        });
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..3], &UTF8_BOM);
        assert_eq!(&bytes[3..], b"hold me\n");
    }
}
