//! `oc_apply_patch` — native multi-hunk patch apply at parity with
//! `packages/core/src/patch.ts` + `packages/core/src/tool/apply-patch.ts`
//! (FR4, FR18, C4, AC5).
//!
//! Parses the `*** Begin Patch` / `*** End Patch` envelope into add/delete/update
//! hunks, matches each update chunk's surrounding context with the reference's
//! four-strategy fallback (exact → right-strip → trim → unicode-normalized), and
//! applies **all or nothing**: if any hunk's context fails to match, the typed
//! `context_mismatch` error is returned and no file is touched. On a full match every
//! hunk is applied atomically and the result reports files changed and hunks applied.

use std::path::{Path, PathBuf};

use opencode_ffi_abi::{FfiError, FfiErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::write::atomic_write_bytes;

/// `oc_apply_patch` request — mirrors `ffi.tools.#ApplyPatchRequest`.
#[derive(Deserialize)]
pub struct ApplyPatchRequest {
    pub patch: String,
    #[serde(default)]
    pub cwd: Option<String>,
}

/// `oc_apply_patch` result — mirrors `ffi.tools.#ApplyPatchResult`.
#[derive(Serialize, Deserialize, Debug)]
pub struct ApplyPatchResult {
    pub files_changed: u64,
    pub hunks_applied: u64,
}

/// One `@@` chunk within an update hunk (mirrors `Patch.UpdateFileChunk`).
struct UpdateChunk {
    old_lines: Vec<String>,
    new_lines: Vec<String>,
    change_context: Option<String>,
    end_of_file: bool,
}

/// One parsed hunk (mirrors `Patch.Hunk`).
enum Hunk {
    Add {
        path: String,
        contents: String,
    },
    Delete {
        path: String,
    },
    Update {
        path: String,
        move_path: Option<String>,
        chunks: Vec<UpdateChunk>,
    },
}

fn invalid(message: impl Into<String>) -> FfiError {
    FfiError::new(FfiErrorCode::InvalidRequest, message)
}

fn context_mismatch(message: impl Into<String>) -> FfiError {
    FfiError::new(FfiErrorCode::ContextMismatch, message)
}

// ---------------------------------------------------------------------------
// Parsing — mirrors patch.ts `parse` / `parseAdd` / `parseUpdate`
// ---------------------------------------------------------------------------

/// Strip a surrounding heredoc wrapper, mirroring `stripHeredoc`.
fn strip_heredoc(input: &str) -> String {
    // Match `[cat ]<<['"]?WORD['"]? \n BODY \n WORD`.
    let bytes = input;
    let trimmed = bytes.trim_start();
    let rest = trimmed
        .strip_prefix("cat ")
        .map(str::trim_start)
        .unwrap_or(trimmed);
    let Some(after) = rest.strip_prefix("<<") else {
        return input.to_string();
    };
    let after = after.trim_start_matches(['\'', '"']);
    let mut word = String::new();
    for ch in after.chars() {
        if ch.is_alphanumeric() || ch == '_' {
            word.push(ch);
        } else {
            break;
        }
    }
    if word.is_empty() {
        return input.to_string();
    }
    let Some(nl) = after.find('\n') else {
        return input.to_string();
    };
    let body_and_tail = &after[nl + 1..];
    let closer = format!("\n{word}");
    if let Some(end) = body_and_tail.rfind(&closer) {
        let tail = &body_and_tail[end + closer.len()..];
        if tail.trim().is_empty() {
            return body_and_tail[..end].to_string();
        }
    }
    input.to_string()
}

fn parse(patch_text: &str) -> Result<Vec<Hunk>, FfiError> {
    let source = strip_heredoc(patch_text.trim());
    let lines: Vec<&str> = source.split('\n').collect();
    let begin = lines.iter().position(|l| l.trim() == "*** Begin Patch");
    let end = lines.iter().position(|l| l.trim() == "*** End Patch");
    let (begin, end) = match (begin, end) {
        (Some(b), Some(e)) if b < e => (b, e),
        _ => return Err(invalid("Invalid patch format: missing Begin/End markers")),
    };

    let mut hunks: Vec<Hunk> = Vec::new();
    let mut index = begin + 1;
    while index < end {
        let line = lines[index];
        if let Some(path) = line.strip_prefix("*** Add File:") {
            let path = path.trim().to_string();
            if path.is_empty() {
                return Err(invalid("Invalid add file path"));
            }
            let (content, next) = parse_add(&lines, index + 1)?;
            hunks.push(Hunk::Add {
                path,
                contents: content,
            });
            index = next;
            continue;
        }
        if let Some(path) = line.strip_prefix("*** Delete File:") {
            let path = path.trim().to_string();
            if path.is_empty() {
                return Err(invalid("Invalid delete file path"));
            }
            hunks.push(Hunk::Delete { path });
            index += 1;
            continue;
        }
        if let Some(path) = line.strip_prefix("*** Update File:") {
            let path = path.trim().to_string();
            if path.is_empty() {
                return Err(invalid("Invalid update file path"));
            }
            let mut next = index + 1;
            let mut move_path: Option<String> = None;
            if let Some(mv) = lines.get(next).and_then(|l| l.strip_prefix("*** Move to:")) {
                let mv = mv.trim().to_string();
                if mv.is_empty() {
                    return Err(invalid("Invalid move file path"));
                }
                move_path = Some(mv);
                next += 1;
            }
            let (chunks, after) = parse_update(&lines, next)?;
            if chunks.is_empty() {
                return Err(invalid(format!(
                    "Invalid update hunk for {path}: expected at least one @@ chunk"
                )));
            }
            hunks.push(Hunk::Update {
                path,
                move_path,
                chunks,
            });
            index = after;
            continue;
        }
        return Err(invalid(format!("Invalid patch line: {line}")));
    }
    Ok(hunks)
}

fn parse_add(lines: &[&str], start: usize) -> Result<(String, usize), FfiError> {
    let mut content: Vec<String> = Vec::new();
    let mut index = start;
    while index < lines.len() && !lines[index].starts_with("***") {
        let line = lines[index];
        let rest = line
            .strip_prefix('+')
            .ok_or_else(|| invalid(format!("Invalid add file line: {line}")))?;
        content.push(rest.to_string());
        index += 1;
    }
    Ok((content.join("\n"), index))
}

fn parse_update(lines: &[&str], start: usize) -> Result<(Vec<UpdateChunk>, usize), FfiError> {
    let mut chunks: Vec<UpdateChunk> = Vec::new();
    let mut index = start;
    while index < lines.len() && !lines[index].starts_with("***") {
        if !lines[index].starts_with("@@") {
            return Err(invalid(format!(
                "Invalid update file line: {}",
                lines[index]
            )));
        }
        let change_context = {
            let ctx = lines[index][2..].trim();
            if ctx.is_empty() {
                None
            } else {
                Some(ctx.to_string())
            }
        };
        let mut old_lines: Vec<String> = Vec::new();
        let mut new_lines: Vec<String> = Vec::new();
        let mut end_of_file = false;
        index += 1;
        while index < lines.len() && !lines[index].starts_with("@@") {
            let line = lines[index];
            if line == "*** End of File" {
                end_of_file = true;
                index += 1;
                break;
            }
            if line.starts_with("***") {
                break;
            }
            if let Some(rest) = line.strip_prefix(' ') {
                old_lines.push(rest.to_string());
                new_lines.push(rest.to_string());
            } else if let Some(rest) = line.strip_prefix('-') {
                old_lines.push(rest.to_string());
            } else if let Some(rest) = line.strip_prefix('+') {
                new_lines.push(rest.to_string());
            } else {
                return Err(invalid(format!("Invalid update chunk line: {line}")));
            }
            index += 1;
        }
        chunks.push(UpdateChunk {
            old_lines,
            new_lines,
            change_context,
            end_of_file,
        });
    }
    Ok((chunks, index))
}

// ---------------------------------------------------------------------------
// Derive — mirrors patch.ts `derive` / `computeReplacements` / `seek`
// ---------------------------------------------------------------------------

fn split_bom(text: &str) -> (String, bool) {
    let stripped = text.trim_start_matches('\u{FEFF}');
    (stripped.to_string(), stripped.len() != text.len())
}

/// Apply an update hunk's chunks to `original`, mirroring `Patch.derive`.
/// Returns the new content and its BOM flag, or `context_mismatch` on a failed seek.
fn derive(path: &str, chunks: &[UpdateChunk], original: &str) -> Result<(String, bool), FfiError> {
    let (text, bom) = split_bom(original);
    let mut lines: Vec<String> = text.split('\n').map(str::to_string).collect();
    if lines.last().map(String::as_str) == Some("") {
        lines.pop();
    }
    let replacements = compute_replacements(&lines, path, chunks)?;

    let mut updated = lines.clone();
    // Apply in reverse index order so earlier splices don't shift later ones.
    let mut ordered = replacements;
    ordered.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    for (start, remove, insert) in ordered {
        let end = (start + remove).min(updated.len());
        let start = start.min(updated.len());
        updated.splice(start..end, insert);
    }
    if updated.last().map(String::as_str) != Some("") {
        updated.push(String::new());
    }
    let (next_text, next_bom) = split_bom(&updated.join("\n"));
    Ok((next_text, bom || next_bom))
}

type Replacement = (usize, usize, Vec<String>);

fn compute_replacements(
    lines: &[String],
    path: &str,
    chunks: &[UpdateChunk],
) -> Result<Vec<Replacement>, FfiError> {
    let mut replacements: Vec<Replacement> = Vec::new();
    let mut line_index = 0usize;
    for chunk in chunks {
        if let Some(context) = &chunk.change_context {
            let found = seek(lines, std::slice::from_ref(context), line_index, false);
            match found {
                Some(pos) => line_index = pos + 1,
                None => {
                    return Err(context_mismatch(format!(
                        "Failed to find context '{context}' in {path}"
                    )))
                }
            }
        }
        if chunk.old_lines.is_empty() {
            replacements.push((lines.len(), 0, chunk.new_lines.clone()));
            continue;
        }
        let mut old_lines: &[String] = &chunk.old_lines;
        let mut new_lines: &[String] = &chunk.new_lines;
        let mut found = seek(lines, old_lines, line_index, chunk.end_of_file);
        // Trailing-blank-line tolerance, mirroring the reference fallback.
        let old_trimmed;
        let new_trimmed;
        if found.is_none() && old_lines.last().map(String::as_str) == Some("") {
            old_trimmed = &old_lines[..old_lines.len() - 1];
            new_trimmed = if new_lines.last().map(String::as_str) == Some("") {
                &new_lines[..new_lines.len() - 1]
            } else {
                new_lines
            };
            old_lines = old_trimmed;
            new_lines = new_trimmed;
            found = seek(lines, old_lines, line_index, chunk.end_of_file);
        }
        let found = found.ok_or_else(|| {
            context_mismatch(format!(
                "Failed to find expected lines in {path}:\n{}",
                chunk.old_lines.join("\n")
            ))
        })?;
        replacements.push((found, old_lines.len(), new_lines.to_vec()));
        line_index = found + old_lines.len();
    }
    replacements.sort_by_key(|entry| entry.0);
    Ok(replacements)
}

/// Locate `pattern` in `lines` at or after `start`, trying the four compare
/// strategies in order (mirrors `seek`). Honors the end-of-file anchor first.
fn seek(lines: &[String], pattern: &[String], start: usize, eof: bool) -> Option<usize> {
    if pattern.is_empty() {
        return None;
    }
    let comparators: [fn(&str, &str) -> bool; 4] =
        [cmp_exact, cmp_rstrip, cmp_trim, cmp_normalized];
    for compare in comparators {
        if eof && lines.len() >= pattern.len() {
            let offset = lines.len() - pattern.len();
            if offset >= start && matches_at(lines, pattern, offset, compare) {
                return Some(offset);
            }
        }
        if lines.len() >= pattern.len() {
            let mut offset = start;
            while offset <= lines.len() - pattern.len() {
                if matches_at(lines, pattern, offset, compare) {
                    return Some(offset);
                }
                offset += 1;
            }
        }
    }
    None
}

fn matches_at(
    lines: &[String],
    pattern: &[String],
    offset: usize,
    compare: fn(&str, &str) -> bool,
) -> bool {
    pattern
        .iter()
        .enumerate()
        .all(|(index, line)| compare(&lines[offset + index], line))
}

fn cmp_exact(left: &str, right: &str) -> bool {
    left == right
}

fn cmp_rstrip(left: &str, right: &str) -> bool {
    left.trim_end() == right.trim_end()
}

fn cmp_trim(left: &str, right: &str) -> bool {
    left.trim() == right.trim()
}

fn cmp_normalized(left: &str, right: &str) -> bool {
    normalize(left.trim()) == normalize(right.trim())
}

/// Unicode punctuation normalization mirroring `normalize` in patch.ts.
fn normalize(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => out.push('\''),
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => out.push('"'),
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2015}' => {
                out.push('-')
            }
            '\u{2026}' => out.push_str("..."),
            '\u{00A0}' => out.push(' '),
            other => out.push(other),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Apply — all-or-nothing (mirrors apply-patch.ts but atomic across every hunk)
// ---------------------------------------------------------------------------

/// A fully prepared, context-matched change ready to commit to disk.
enum Prepared {
    Add { target: PathBuf, content: String },
    Delete { target: PathBuf },
    Update { target: PathBuf, content: String },
}

fn resolve(cwd: &Option<String>, path: &str) -> PathBuf {
    match cwd {
        Some(base) => Path::new(base).join(path),
        None => PathBuf::from(path),
    }
}

/// Ensure add-file content ends with a trailing newline, mirroring the reference.
fn add_content(contents: &str) -> String {
    if contents.ends_with('\n') || contents.is_empty() {
        contents.to_string()
    } else {
        format!("{contents}\n")
    }
}

fn join_bom(text: &str, bom: bool) -> String {
    let (stripped, _) = split_bom(text);
    if bom {
        format!("\u{FEFF}{stripped}")
    } else {
        stripped
    }
}

/// Apply a patch against `cwd`, all-or-nothing, and produce `#ApplyPatchResult`.
pub fn apply_patch(req: ApplyPatchRequest) -> Result<Value, FfiError> {
    if req.patch.trim().is_empty() {
        return Err(invalid("patchText is required"));
    }
    let hunks = parse(&req.patch)?;
    if hunks.is_empty() {
        return Err(invalid("patch rejected: empty patch"));
    }
    if hunks.iter().any(|h| {
        matches!(
            h,
            Hunk::Update {
                move_path: Some(_),
                ..
            }
        )
    }) {
        return Err(invalid("apply_patch moves are not supported yet"));
    }

    // Prepare every hunk first; a context failure here aborts before any write.
    let mut prepared: Vec<Prepared> = Vec::new();
    let mut hunks_applied: u64 = 0;
    let mut files_changed: u64 = 0;
    for hunk in &hunks {
        match hunk {
            Hunk::Add { path, contents } => {
                let target = resolve(&req.cwd, path);
                if target.exists() {
                    return Err(FfiError::new(
                        FfiErrorCode::IoError,
                        format!("Cannot add file, already exists: {path}"),
                    ));
                }
                prepared.push(Prepared::Add {
                    target,
                    content: add_content(contents),
                });
                files_changed += 1;
                hunks_applied += 1;
            }
            Hunk::Delete { path } => {
                let target = resolve(&req.cwd, path);
                let meta = std::fs::metadata(&target)
                    .map_err(|_| context_mismatch(format!("Cannot delete missing file: {path}")))?;
                if !meta.is_file() {
                    return Err(context_mismatch(format!("Cannot delete non-file: {path}")));
                }
                prepared.push(Prepared::Delete { target });
                files_changed += 1;
                hunks_applied += 1;
            }
            Hunk::Update { path, chunks, .. } => {
                let target = resolve(&req.cwd, path);
                let bytes = std::fs::read(&target)
                    .map_err(|_| context_mismatch(format!("Cannot update missing file: {path}")))?;
                let original = decode_lossless(&bytes)?;
                let (content, bom) = derive(path, chunks, &original)?;
                prepared.push(Prepared::Update {
                    target,
                    content: join_bom(&content, bom),
                });
                files_changed += 1;
                hunks_applied += chunks.len() as u64;
            }
        }
    }

    // Commit — every context already matched, so this stage does not fail on content.
    for change in prepared {
        match change {
            Prepared::Add { target, content } => {
                if let Some(parent) = target.parent() {
                    if !parent.as_os_str().is_empty() {
                        std::fs::create_dir_all(parent).map_err(|err| {
                            FfiError::new(FfiErrorCode::IoError, format!("{err}"))
                        })?;
                    }
                }
                atomic_write_bytes(&target, content.as_bytes())?;
            }
            Prepared::Delete { target } => {
                std::fs::remove_file(&target)
                    .map_err(|err| FfiError::new(FfiErrorCode::IoError, format!("{err}")))?;
            }
            Prepared::Update { target, content } => {
                atomic_write_bytes(&target, content.as_bytes())?;
            }
        }
    }

    Ok(serde_json::to_value(ApplyPatchResult {
        files_changed,
        hunks_applied,
    })
    .expect("apply_patch result serializes"))
}

/// Decode UTF-8 ignoring a leading BOM (the reference uses `ignoreBOM: true` then
/// strips a leading `U+FEFF`). A malformed sequence yields `malformed_utf8`.
fn decode_lossless(bytes: &[u8]) -> Result<String, FfiError> {
    std::str::from_utf8(bytes)
        .map(str::to_string)
        .map_err(|_| FfiError::new(FfiErrorCode::MalformedUtf8, "File is not valid UTF-8"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("oc_patch_{}_{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn run(dir: &Path, patch: &str) -> Result<ApplyPatchResult, FfiError> {
        apply_patch(ApplyPatchRequest {
            patch: patch.to_string(),
            cwd: Some(dir.to_string_lossy().into_owned()),
        })
        .map(|v| serde_json::from_value(v).unwrap())
    }

    #[test]
    fn multi_hunk_update_applies_every_chunk() {
        let dir = temp_dir("multi");
        std::fs::write(dir.join("f.txt"), "a\nb\nc\nd\ne\nf\n").unwrap();
        let patch = "*** Begin Patch\n\
*** Update File: f.txt\n\
@@\n a\n-b\n+B\n c\n\
@@\n e\n-f\n+F\n\
*** End Patch";
        let out = run(&dir, patch).unwrap();
        assert_eq!(out.files_changed, 1);
        assert_eq!(out.hunks_applied, 2);
        assert_eq!(
            std::fs::read_to_string(dir.join("f.txt")).unwrap(),
            "a\nB\nc\nd\ne\nF\n"
        );
    }

    #[test]
    fn context_mismatch_applies_nothing() {
        let dir = temp_dir("mismatch");
        let before = "keep this\nand this\n";
        std::fs::write(dir.join("g.txt"), before).unwrap();
        std::fs::write(dir.join("h.txt"), "x\ny\n").unwrap();
        // First hunk matches h.txt; second hunk's context does NOT match g.txt.
        let patch = "*** Begin Patch\n\
*** Update File: h.txt\n\
@@\n x\n-y\n+Y\n\
*** Update File: g.txt\n\
@@\n-nonexistent line\n+replacement\n\
*** End Patch";
        let err = run(&dir, patch).unwrap_err();
        assert_eq!(err.code, FfiErrorCode::ContextMismatch);
        // Neither file changed — the earlier matching hunk was NOT committed.
        assert_eq!(std::fs::read_to_string(dir.join("g.txt")).unwrap(), before);
        assert_eq!(
            std::fs::read_to_string(dir.join("h.txt")).unwrap(),
            "x\ny\n"
        );
    }

    #[test]
    fn add_and_delete_operations_apply() {
        let dir = temp_dir("adddel");
        std::fs::write(dir.join("old.txt"), "gone\n").unwrap();
        let patch = "*** Begin Patch\n\
*** Add File: new.txt\n\
+first line\n+second line\n\
*** Delete File: old.txt\n\
*** End Patch";
        let out = run(&dir, patch).unwrap();
        assert_eq!(out.files_changed, 2);
        assert_eq!(out.hunks_applied, 2);
        assert_eq!(
            std::fs::read_to_string(dir.join("new.txt")).unwrap(),
            "first line\nsecond line\n"
        );
        assert!(!dir.join("old.txt").exists());
    }

    #[test]
    fn missing_markers_are_invalid_request() {
        let dir = temp_dir("nomarkers");
        let err = run(&dir, "just some text\nno markers").unwrap_err();
        assert_eq!(err.code, FfiErrorCode::InvalidRequest);
    }

    #[test]
    fn empty_patch_is_rejected() {
        let dir = temp_dir("empty");
        let err = run(&dir, "   ").unwrap_err();
        assert_eq!(err.code, FfiErrorCode::InvalidRequest);
    }

    #[test]
    fn moves_are_not_supported() {
        let dir = temp_dir("move");
        std::fs::write(dir.join("m.txt"), "a\n").unwrap();
        let patch = "*** Begin Patch\n\
*** Update File: m.txt\n\
*** Move to: n.txt\n\
@@\n-a\n+b\n\
*** End Patch";
        let err = run(&dir, patch).unwrap_err();
        assert_eq!(err.code, FfiErrorCode::InvalidRequest);
        assert_eq!(err.message, "apply_patch moves are not supported yet");
    }
}
