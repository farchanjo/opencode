//! `oc_write` — native filesystem write at parity with
//! `packages/core/src/tool/write.ts` / `FileMutation.writeTextPreservingBom`
//! (FR2, FR18, AC3).
//!
//! The write is **atomic**: the content is written to a temporary file in the
//! destination directory and then renamed over the target, so an interrupted write
//! never leaves a truncated destination — the destination is always either the full
//! new content or the unchanged prior content.
//!
//! BOM preservation mirrors the TypeScript reference: the content's own leading
//! `U+FEFF` run is stripped, and a UTF-8 BOM is written back when the prior file
//! carried one or the content itself carried one (`writeTextPreservingBom`).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use opencode_ffi_abi::{FfiError, FfiErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `oc_write` request — mirrors `ffi.tools.#WriteRequest`.
#[derive(Deserialize)]
pub struct WriteRequest {
    pub path: String,
    pub content: String,
}

/// `oc_write` result — mirrors `ffi.tools.#WriteResult`.
#[derive(Serialize, Deserialize)]
pub struct WriteResult {
    pub created: bool,
    pub byte_count: u64,
}

/// The three UTF-8 BOM bytes.
const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
/// The BOM character prepended when the target keeps a BOM.
const BOM_CHAR: char = '\u{FEFF}';

/// Strip the leading `U+FEFF` run from `text`, mirroring `splitBom` in
/// `file-mutation.ts` (`text.replace(/^﻿+/, "")`). Returns the stripped text and
/// whether any BOM char was present.
fn split_bom(text: &str) -> (String, bool) {
    let stripped = text.trim_start_matches(BOM_CHAR);
    (stripped.to_string(), stripped.len() != text.len())
}

/// Whether the on-disk bytes begin with a UTF-8 BOM (`hasUtf8Bom`).
fn has_utf8_bom(bytes: &[u8]) -> bool {
    bytes.len() >= 3 && bytes[..3] == UTF8_BOM
}

fn io_error(err: std::io::Error) -> FfiError {
    FfiError::new(FfiErrorCode::IoError, format!("{err}"))
}

/// Monotonic suffix source so concurrent atomic writes never collide on a temp name.
static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// The temp-file path for the atomic write: a sibling of the target so `rename`
/// stays on the same filesystem (and is therefore atomic). The name is made unique
/// per call by a process-wide monotonic counter, so parallel writes never clash.
fn temp_path(target: &Path) -> PathBuf {
    let dir = target.parent().unwrap_or_else(|| Path::new("."));
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    dir.join(format!(".oc_write_{}_{seq}.tmp", std::process::id()))
}

/// Atomically write `bytes` to `target`: write to a sibling temp file, then rename
/// over the destination. On any failure the temp file is removed. Shared by
/// `oc_write`, `oc_edit`, and `oc_apply_patch` so every mutation is crash-safe.
pub fn atomic_write_bytes(target: &Path, bytes: &[u8]) -> Result<(), FfiError> {
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(io_error)?;
        }
    }
    let tmp = temp_path(target);
    let write_and_rename = || -> std::io::Result<()> {
        std::fs::write(&tmp, bytes)?;
        std::fs::rename(&tmp, target)
    };
    write_and_rename().map_err(|err| {
        let _ = std::fs::remove_file(&tmp);
        io_error(err)
    })
}

/// Write a file at parity with the TypeScript reference and produce the
/// `#WriteResult` (`created` distinguishes create from overwrite; `byte_count` is the
/// UTF-8 byte length actually written).
pub fn write(req: WriteRequest) -> Result<Value, FfiError> {
    let target = Path::new(&req.path);

    let existing = std::fs::read(target).ok();
    let existed = existing.is_some();
    let prior_bom = existing.as_deref().map(has_utf8_bom).unwrap_or(false);

    let (stripped, content_bom) = split_bom(&req.content);
    let keep_bom = prior_bom || content_bom;

    let mut out = String::new();
    if keep_bom {
        out.push(BOM_CHAR);
    }
    out.push_str(&stripped);

    let bytes = out.into_bytes();
    atomic_write_bytes(target, &bytes)?;

    Ok(serde_json::to_value(WriteResult {
        created: !existed,
        byte_count: bytes.len() as u64,
    })
    .expect("write result serializes"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("oc_write_{}_{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_ok(req: WriteRequest) -> WriteResult {
        serde_json::from_value(write(req).unwrap()).unwrap()
    }

    #[test]
    fn creates_a_new_file_and_reports_created() {
        let dir = temp_dir("create");
        let path = dir.join("new.txt");
        let out = write_ok(WriteRequest {
            path: path.to_string_lossy().into_owned(),
            content: "hello\nworld\n".into(),
        });
        assert!(out.created);
        assert_eq!(out.byte_count, 12);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello\nworld\n");
    }

    #[test]
    fn overwrites_an_existing_file_and_reports_not_created() {
        let dir = temp_dir("overwrite");
        let path = dir.join("existing.txt");
        std::fs::write(&path, b"old content that is longer").unwrap();
        let out = write_ok(WriteRequest {
            path: path.to_string_lossy().into_owned(),
            content: "new".into(),
        });
        assert!(!out.created);
        // The destination is fully replaced — never a truncation of the old bytes.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn preserves_a_prior_utf8_bom() {
        let dir = temp_dir("prior_bom");
        let path = dir.join("bom.txt");
        std::fs::write(&path, [&UTF8_BOM[..], b"original"].concat()).unwrap();
        write_ok(WriteRequest {
            path: path.to_string_lossy().into_owned(),
            content: "replacement".into(),
        });
        let bytes = std::fs::read(&path).unwrap();
        assert!(has_utf8_bom(&bytes));
        assert_eq!(&bytes[3..], b"replacement");
    }

    #[test]
    fn preserves_a_content_bom_and_does_not_double_it() {
        let dir = temp_dir("content_bom");
        let path = dir.join("cbom.txt");
        write_ok(WriteRequest {
            path: path.to_string_lossy().into_owned(),
            content: "\u{FEFF}body".into(),
        });
        let bytes = std::fs::read(&path).unwrap();
        assert!(has_utf8_bom(&bytes));
        // Exactly one BOM, not doubled.
        assert_eq!(&bytes[3..], b"body");
        assert!(!has_utf8_bom(&bytes[3..]));
    }

    #[test]
    fn write_creates_parent_directories() {
        let dir = temp_dir("nested");
        let path = dir.join("a/b/c/deep.txt");
        let out = write_ok(WriteRequest {
            path: path.to_string_lossy().into_owned(),
            content: "deep".into(),
        });
        assert!(out.created);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "deep");
    }

    #[test]
    fn atomic_write_leaves_no_temp_file_behind() {
        let dir = temp_dir("no_temp");
        let path = dir.join("clean.txt");
        write_ok(WriteRequest {
            path: path.to_string_lossy().into_owned(),
            content: "content".into(),
        });
        // The sibling temp file was renamed away — the destination dir holds only the
        // target, never a lingering `.oc_write_*.tmp`.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".oc_write_"))
            .collect();
        assert!(leftovers.is_empty(), "temp file leaked: {leftovers:?}");
    }
}
