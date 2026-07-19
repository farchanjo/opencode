//! `oc_read` — native filesystem read at byte-identical parity with
//! `packages/core/src/tool/read-filesystem.ts` (FR1, C7, C16, AC2).
//!
//! Mirrors the TypeScript reference: 1-based offset/limit windowing, the
//! `MAX_READ_LINES` / `MAX_READ_BYTES` page caps, the 2000-char line cap with the
//! `... (line truncated to 2000 chars)` suffix, the paged-vs-whole decision (paged
//! when the file exceeds `MAX_READ_BYTES` or an explicit offset/limit is supplied),
//! the `next` continuation cursor and `truncated` flag, binary detection (NUL byte,
//! non-printable ratio `> 0.3`, the known-extension set, PDF/PNG/JPEG/GIF/WEBP
//! magic), the UTF-8 fatal-decode contract (`malformed_utf8`), and the
//! `offset_out_of_range` error.
//!
//! Line truncation counts UTF-16 code units and slices on the same boundary as the
//! JavaScript reference (`String.prototype.length` / `slice`), so a non-ASCII line is
//! truncated at the identical position.

use std::path::Path;

use opencode_ffi_abi::{
    FfiError, FfiErrorCode, LINE_TRUNCATION_SUFFIX, MAX_LINE_LENGTH, MAX_READ_BYTES, MAX_READ_LINES,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `oc_read` request — mirrors `ffi.tools.#ReadRequest` (1-based `offset`/`limit`).
#[derive(Deserialize)]
pub struct ReadRequest {
    pub path: String,
    #[serde(default)]
    pub offset: Option<u64>,
    #[serde(default)]
    pub limit: Option<u64>,
}

/// `oc_read` result — mirrors `ffi.tools.#ReadResult`.
#[derive(Serialize, Deserialize)]
pub struct ReadResult {
    pub content: String,
    pub line_count: u64,
    pub byte_count: u64,
    pub truncated: bool,
    pub next: Option<u64>,
}

/// The known-binary extension set mirrored from `read-filesystem.ts`.
const BINARY_EXTENSIONS: &[&str] = &[
    "zip", "tar", "gz", "exe", "dll", "so", "class", "jar", "war", "7z", "doc", "docx", "xls",
    "xlsx", "ppt", "pptx", "odt", "ods", "odp", "bin", "dat", "obj", "o", "a", "lib", "wasm",
    "pyc", "pyo",
];

fn has_binary_extension(path: &str) -> bool {
    match Path::new(path).extension().and_then(|e| e.to_str()) {
        Some(ext) => BINARY_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()),
        None => false,
    }
}

fn starts_with(bytes: &[u8], prefix: &[u8]) -> bool {
    bytes.len() >= prefix.len() && &bytes[..prefix.len()] == prefix
}

/// PNG/JPEG/GIF/WEBP magic detection, mirroring `imageMime` in the reference.
fn is_image_magic(bytes: &[u8]) -> bool {
    if starts_with(bytes, &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) {
        return true;
    }
    if starts_with(bytes, &[0xff, 0xd8, 0xff]) {
        return true;
    }
    if starts_with(bytes, &[0x47, 0x49, 0x46, 0x38]) {
        return true;
    }
    if starts_with(bytes, &[0x52, 0x49, 0x46, 0x46])
        && bytes.len() >= 12
        && &bytes[8..12] == b"WEBP"
    {
        return true;
    }
    false
}

/// Binary detection mirroring `binary()` in the reference: NUL byte or a
/// non-printable ratio above `0.3` marks the buffer as binary.
fn is_binary(path: &str, bytes: &[u8]) -> bool {
    if has_binary_extension(path) {
        return true;
    }
    if bytes.is_empty() {
        return false;
    }
    let mut non_printable = 0usize;
    for &byte in bytes {
        if byte == 0 {
            return true;
        }
        if byte < 9 || (byte > 13 && byte < 32) {
            non_printable += 1;
        }
    }
    (non_printable as f64) / (bytes.len() as f64) > 0.3
}

/// Fatal UTF-8 decode — a malformed sequence yields `malformed_utf8` (never a lossy
/// replacement), matching the reference's `TextDecoder({ fatal: true })`.
fn decode_utf8(path: &str, bytes: &[u8]) -> Result<String, FfiError> {
    std::str::from_utf8(bytes)
        .map(|s| s.to_string())
        .map_err(|_| {
            FfiError::new(
                FfiErrorCode::MalformedUtf8,
                format!("File is not valid UTF-8: {path}"),
            )
        })
}

/// UTF-16 code-unit length of a string, matching JavaScript `String#length`.
fn utf16_len(text: &str) -> usize {
    text.chars().map(|c| c.len_utf16()).sum()
}

/// Take the first `limit` UTF-16 code units, matching JavaScript `slice(0, limit)`
/// on a boundary that never splits a Rust scalar (astral planes stay whole).
fn take_utf16(text: &str, limit: usize) -> String {
    let mut out = String::new();
    let mut units = 0usize;
    for ch in text.chars() {
        let width = ch.len_utf16();
        if units + width > limit {
            break;
        }
        out.push(ch);
        units += width;
    }
    out
}

/// Apply the 2000-char line cap + suffix exactly as the reference `append` does.
fn truncate_line(line: &str) -> String {
    if utf16_len(line) > MAX_LINE_LENGTH as usize {
        format!(
            "{}{}",
            take_utf16(line, MAX_LINE_LENGTH as usize),
            LINE_TRUNCATION_SUFFIX
        )
    } else {
        line.to_string()
    }
}

fn not_found(path: &str) -> FfiError {
    FfiError::new(FfiErrorCode::NotFound, format!("File not found: {path}"))
}

/// Read a file at parity with the TypeScript reference and produce the `#ReadResult`.
pub fn read(req: ReadRequest) -> Result<Value, FfiError> {
    let meta = std::fs::metadata(&req.path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => not_found(&req.path),
        _ => FfiError::new(FfiErrorCode::IoError, format!("{err}")),
    })?;
    if meta.is_dir() {
        return Err(FfiError::new(
            FfiErrorCode::NotAFile,
            format!("Path is not a file: {}", req.path),
        ));
    }

    let bytes = std::fs::read(&req.path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => not_found(&req.path),
        _ => FfiError::new(FfiErrorCode::IoError, format!("{err}")),
    })?;

    let head_len = bytes.len().min(64 * 1024);
    let head = &bytes[..head_len];

    // Image + PDF + known-extension short-circuits, mirroring the reference order.
    // Native has no media result shape; an image is surfaced as `binary_file` so the
    // model-facing wrapper falls back to the TypeScript media path (documented gap).
    if is_image_magic(head) {
        return Err(FfiError::new(
            FfiErrorCode::BinaryFile,
            format!("Cannot read binary file: {}", req.path),
        ));
    }
    if starts_with(head, &[0x25, 0x50, 0x44, 0x46]) || has_binary_extension(&req.path) {
        return Err(FfiError::new(
            FfiErrorCode::BinaryFile,
            format!("Cannot read binary file: {}", req.path),
        ));
    }

    let paged = bytes.len() as u64 > MAX_READ_BYTES || req.offset.is_some() || req.limit.is_some();

    if !paged {
        if is_binary(&req.path, head) {
            return Err(FfiError::new(
                FfiErrorCode::BinaryFile,
                format!("Cannot read binary file: {}", req.path),
            ));
        }
        let content = decode_utf8(&req.path, &bytes)?;
        let line_count = if content.is_empty() {
            0
        } else {
            content.matches('\n').count() as u64 + 1
        };
        let byte_count = content.len() as u64;
        return Ok(serde_json::to_value(ReadResult {
            content,
            line_count,
            byte_count,
            truncated: false,
            next: None,
        })
        .expect("read result serializes"));
    }

    read_paged(req, &bytes)
}

/// The paged read: 1-based offset/limit windowing with the `MAX_READ_BYTES` byte
/// budget, matching the reference `append` / `consume` state machine.
fn read_paged(req: ReadRequest, bytes: &[u8]) -> Result<Value, FfiError> {
    let offset = req.offset.unwrap_or(1);
    let limit = req.limit.unwrap_or(MAX_READ_LINES).min(MAX_READ_LINES);

    let mut lines: Vec<String> = Vec::new();
    let mut total_bytes: u64 = 0;
    let mut current_line: u64 = 1;
    let mut next: Option<u64> = None;

    // Append one logical line, honoring the offset skip, the line/byte caps, and the
    // 2000-char truncation. Returns false when the page is full (sets `next`).
    let append = |line: &str,
                  lines: &mut Vec<String>,
                  total_bytes: &mut u64,
                  current_line: &mut u64,
                  next: &mut Option<u64>|
     -> bool {
        if *current_line < offset {
            *current_line += 1;
            return true;
        }
        if lines.len() as u64 >= limit || *total_bytes >= MAX_READ_BYTES {
            *next = Some(*current_line);
            return false;
        }
        let text = truncate_line(line);
        let size = text.len() as u64 + if lines.is_empty() { 0 } else { 1 };
        if *total_bytes + size > MAX_READ_BYTES {
            *next = Some(*current_line);
            return false;
        }
        lines.push(text);
        *total_bytes += size;
        *current_line += 1;
        true
    };

    let mut start = 0usize;
    let mut index = 0usize;
    let mut stopped = false;
    while index < bytes.len() {
        if bytes[index] == b'\n' {
            let segment = &bytes[start..index];
            if is_binary(&req.path, segment) {
                return Err(FfiError::new(
                    FfiErrorCode::BinaryFile,
                    format!("Cannot read binary file: {}", req.path),
                ));
            }
            let decoded = decode_utf8(&req.path, segment)?;
            let line = decoded.strip_suffix('\r').unwrap_or(&decoded);
            if !append(
                line,
                &mut lines,
                &mut total_bytes,
                &mut current_line,
                &mut next,
            ) {
                stopped = true;
                break;
            }
            start = index + 1;
        }
        index += 1;
    }
    // Trailing remainder without a terminating newline is one more logical line.
    if !stopped && start < bytes.len() {
        let segment = &bytes[start..];
        if is_binary(&req.path, segment) {
            return Err(FfiError::new(
                FfiErrorCode::BinaryFile,
                format!("Cannot read binary file: {}", req.path),
            ));
        }
        let decoded = decode_utf8(&req.path, segment)?;
        let line = decoded.strip_suffix('\r').unwrap_or(&decoded);
        append(
            line,
            &mut lines,
            &mut total_bytes,
            &mut current_line,
            &mut next,
        );
    }

    if lines.is_empty() && offset != 1 {
        return Err(FfiError::new(
            FfiErrorCode::OffsetOutOfRange,
            format!("Offset {offset} is out of range"),
        ));
    }

    let content = lines.join("\n");
    let byte_count = content.len() as u64;
    Ok(serde_json::to_value(ReadResult {
        line_count: lines.len() as u64,
        byte_count,
        truncated: next.is_some(),
        next,
        content,
    })
    .expect("read result serializes"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(name: &str, bytes: &[u8]) -> String {
        let mut path = std::env::temp_dir();
        path.push(format!("oc_read_{}_{}", std::process::id(), name));
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(bytes).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn read_ok(req: ReadRequest) -> ReadResult {
        let value = read(req).unwrap();
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn whole_file_preserves_crlf_and_content() {
        let path = write_temp("whole.txt", b"alpha\r\nbeta\ngamma");
        let out = read_ok(ReadRequest {
            path,
            offset: None,
            limit: None,
        });
        assert_eq!(out.content, "alpha\r\nbeta\ngamma");
        assert!(!out.truncated);
        assert_eq!(out.next, None);
    }

    #[test]
    fn paged_strips_cr_and_windows_by_offset_limit() {
        let path = write_temp("paged.txt", b"one\r\ntwo\r\nthree\r\nfour\r\n");
        let out = read_ok(ReadRequest {
            path,
            offset: Some(2),
            limit: Some(2),
        });
        assert_eq!(out.content, "two\nthree");
        assert_eq!(out.line_count, 2);
        assert!(out.truncated);
        assert_eq!(out.next, Some(4));
    }

    #[test]
    fn line_cap_truncates_at_2000_with_suffix() {
        let long = "x".repeat(2500);
        let path = write_temp("long.txt", format!("{long}\nshort").as_bytes());
        let out = read_ok(ReadRequest {
            path,
            offset: Some(1),
            limit: Some(1),
        });
        let expected = format!("{}{}", "x".repeat(2000), LINE_TRUNCATION_SUFFIX);
        assert_eq!(out.content, expected);
    }

    #[test]
    fn binary_nul_byte_is_rejected() {
        let path = write_temp("bin.dat0", b"abc\0def\nmore");
        // `.dat0` is not a known extension, so detection is content-driven.
        let err = read(ReadRequest {
            path,
            offset: None,
            limit: None,
        })
        .unwrap_err();
        assert_eq!(err.code, FfiErrorCode::BinaryFile);
    }

    #[test]
    fn known_binary_extension_is_rejected() {
        let path = write_temp("archive.zip", b"plain text but zip ext");
        let err = read(ReadRequest {
            path,
            offset: None,
            limit: None,
        })
        .unwrap_err();
        assert_eq!(err.code, FfiErrorCode::BinaryFile);
    }

    #[test]
    fn malformed_utf8_is_reported() {
        let path = write_temp("bad.txt", &[0xff, 0xfe, b'a', b'b']);
        // 0xff/0xfe are non-printable but under the 0.3 ratio for this length, so
        // decode runs and fails fatally.
        let err = read(ReadRequest {
            path,
            offset: Some(1),
            limit: Some(10),
        })
        .unwrap_err();
        assert!(matches!(
            err.code,
            FfiErrorCode::MalformedUtf8 | FfiErrorCode::BinaryFile
        ));
    }

    #[test]
    fn offset_beyond_eof_is_out_of_range() {
        let path = write_temp("small.txt", b"only\ntwo\n");
        let err = read(ReadRequest {
            path,
            offset: Some(50),
            limit: Some(5),
        })
        .unwrap_err();
        assert_eq!(err.code, FfiErrorCode::OffsetOutOfRange);
    }

    #[test]
    fn non_ascii_utf8_round_trips() {
        let path = write_temp("utf8.txt", "café\nnaïve\nΩmega".as_bytes());
        let out = read_ok(ReadRequest {
            path,
            offset: Some(1),
            limit: Some(2),
        });
        assert_eq!(out.content, "café\nnaïve");
    }

    #[test]
    fn interior_blank_line_is_preserved_trailing_newline_is_not() {
        let path = write_temp("blank.txt", b"a\n\nb\n");
        let out = read_ok(ReadRequest {
            path,
            offset: Some(1),
            limit: Some(10),
        });
        assert_eq!(out.content, "a\n\nb");
        assert_eq!(out.line_count, 3);
    }

    #[test]
    fn directory_is_not_a_file() {
        let dir = std::env::temp_dir();
        let err = read(ReadRequest {
            path: dir.to_string_lossy().into_owned(),
            offset: None,
            limit: None,
        })
        .unwrap_err();
        assert_eq!(err.code, FfiErrorCode::NotAFile);
    }

    #[test]
    fn missing_file_is_not_found() {
        let err = read(ReadRequest {
            path: "/no/such/oc_read/path".into(),
            offset: None,
            limit: None,
        })
        .unwrap_err();
        assert_eq!(err.code, FfiErrorCode::NotFound);
    }
}
