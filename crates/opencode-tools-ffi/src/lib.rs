//! opencode-tools-ffi — native filesystem/text tool entry points (Feature 010).
//!
//! Phase 2 slices (T004, T005) implement the first two entry points — `oc_read`
//! and `oc_grep` — and Phase 3 (T009–T012) adds `oc_write`, `oc_edit`,
//! `oc_apply_patch`, and `oc_glob`. Every entry point wraps its body in
//! [`opencode_ffi_abi::protect`] so any panic becomes the `internal_panic` envelope
//! and never crosses the boundary.
//!
//! This crate also re-exports the shared, panic-safe ABI handshake surface
//! (`oc_free`, `oc_abi_version`, `oc_version`, and the debug-gated
//! `oc_alloc_stats`) from `opencode-ffi-abi`, so the compiled `cdylib` is loadable
//! and passes the loader's ABI handshake.

use std::ffi::c_char;

use opencode_ffi_abi::{protect, FfiError, FfiErrorCode};
use serde::de::DeserializeOwned;

mod edit;
mod glob;
mod grep;
mod patch;
mod read;
mod write;

opencode_ffi_abi::export_ffi_abi!();

/// Deserialize a tool request from the raw FFI request buffer. A null pointer, a
/// non-UTF-8 buffer, or a malformed JSON body yields the typed `invalid_request`
/// error rather than panicking (FR14, Security: input validation).
///
/// # Safety
/// `req_ptr` must either be null or point to `req_len` initialized bytes owned by
/// the caller for the duration of the call; the bytes are only read, never retained.
fn parse_request<T: DeserializeOwned>(req_ptr: *const u8, req_len: usize) -> Result<T, FfiError> {
    if req_ptr.is_null() || req_len == 0 {
        return Err(FfiError::new(
            FfiErrorCode::InvalidRequest,
            "empty FFI request buffer",
        ));
    }
    // SAFETY: the loader marshals a JSON request buffer of exactly `req_len` bytes
    // and keeps it alive across the call; we only read it here.
    let bytes = unsafe { std::slice::from_raw_parts(req_ptr, req_len) };
    serde_json::from_slice(bytes)
        .map_err(|err| FfiError::new(FfiErrorCode::InvalidRequest, format!("{err}")))
}

/// `oc_read` — native filesystem read at parity with `read-filesystem.ts` (FR1, AC2).
///
/// # Safety
/// See [`parse_request`]: `req_ptr`/`req_len` describe a caller-owned request buffer.
#[no_mangle]
pub unsafe extern "C" fn oc_read(req_ptr: *const u8, req_len: usize) -> *mut c_char {
    protect(move || {
        let request: read::ReadRequest = parse_request(req_ptr, req_len)?;
        read::read(request)
    })
}

/// `oc_grep` — embedded content search at parity with `ripgrep.ts` output (FR6, AC7).
///
/// # Safety
/// See [`parse_request`]: `req_ptr`/`req_len` describe a caller-owned request buffer.
#[no_mangle]
pub unsafe extern "C" fn oc_grep(req_ptr: *const u8, req_len: usize) -> *mut c_char {
    protect(move || {
        let request: grep::GrepRequest = parse_request(req_ptr, req_len)?;
        grep::grep(request)
    })
}

/// `oc_write` — atomic create/overwrite at parity with `write.ts` (FR2, AC3).
///
/// # Safety
/// See [`parse_request`]: `req_ptr`/`req_len` describe a caller-owned request buffer.
#[no_mangle]
pub unsafe extern "C" fn oc_write(req_ptr: *const u8, req_len: usize) -> *mut c_char {
    protect(move || {
        let request: write::WriteRequest = parse_request(req_ptr, req_len)?;
        write::write(request)
    })
}

/// `oc_edit` — exact string replacement with uniqueness at parity with `edit.ts`
/// (FR3, AC4).
///
/// # Safety
/// See [`parse_request`]: `req_ptr`/`req_len` describe a caller-owned request buffer.
#[no_mangle]
pub unsafe extern "C" fn oc_edit(req_ptr: *const u8, req_len: usize) -> *mut c_char {
    protect(move || {
        let request: edit::EditRequest = parse_request(req_ptr, req_len)?;
        edit::edit(request)
    })
}

/// `oc_apply_patch` — multi-hunk apply with all-or-nothing context matching at
/// parity with `apply-patch.ts` (FR4, AC5).
///
/// # Safety
/// See [`parse_request`]: `req_ptr`/`req_len` describe a caller-owned request buffer.
#[no_mangle]
pub unsafe extern "C" fn oc_apply_patch(req_ptr: *const u8, req_len: usize) -> *mut c_char {
    protect(move || {
        let request: patch::ApplyPatchRequest = parse_request(req_ptr, req_len)?;
        patch::apply_patch(request)
    })
}

/// `oc_glob` — `.gitignore`-aware, mtime-sorted file-pattern search (FR5, AC6).
///
/// # Safety
/// See [`parse_request`]: `req_ptr`/`req_len` describe a caller-owned request buffer.
#[no_mangle]
pub unsafe extern "C" fn oc_glob(req_ptr: *const u8, req_len: usize) -> *mut c_char {
    protect(move || {
        let request: glob::GlobRequest = parse_request(req_ptr, req_len)?;
        glob::glob(request)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::io::Write;

    /// Drive an entry point through the real FFI signature and decode the envelope.
    unsafe fn call(
        entry: unsafe extern "C" fn(*const u8, usize) -> *mut c_char,
        request: Value,
    ) -> Value {
        let json = serde_json::to_vec(&request).unwrap();
        // SAFETY: `json` outlives the call; the entry point reads it and returns an
        // owned NUL-terminated C string we decode and then release via `oc_free`.
        let text = unsafe {
            let ptr = entry(json.as_ptr(), json.len());
            let text = std::ffi::CStr::from_ptr(ptr).to_str().unwrap().to_string();
            opencode_ffi_abi::free(ptr);
            text
        };
        serde_json::from_str(&text).unwrap()
    }

    #[test]
    fn oc_read_returns_ok_envelope_for_text() {
        let mut path = std::env::temp_dir();
        path.push(format!("oc_read_entry_{}.txt", std::process::id()));
        std::fs::File::create(&path)
            .unwrap()
            .write_all(b"hello\nworld\n")
            .unwrap();
        let response = unsafe {
            call(
                oc_read,
                serde_json::json!({ "path": path.to_string_lossy(), "offset": null, "limit": null }),
            )
        };
        assert_eq!(response["status"], "ok");
        assert_eq!(response["result"]["content"], "hello\nworld\n");
    }

    #[test]
    fn oc_read_reports_not_found() {
        let response = unsafe {
            call(
                oc_read,
                serde_json::json!({ "path": "/no/such/oc_read/entry", "offset": null, "limit": null }),
            )
        };
        assert_eq!(response["status"], "error");
        assert_eq!(response["error"]["code"], "not_found");
    }

    #[test]
    fn oc_read_rejects_empty_request() {
        let ptr = unsafe { oc_read(std::ptr::null(), 0) };
        let text = unsafe { std::ffi::CStr::from_ptr(ptr) }
            .to_str()
            .unwrap()
            .to_string();
        opencode_ffi_abi::free(ptr);
        let response: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(response["error"]["code"], "invalid_request");
    }

    #[test]
    fn oc_grep_returns_content_matches() {
        let mut dir = std::env::temp_dir();
        dir.push(format!("oc_grep_entry_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::File::create(dir.join("f.txt"))
            .unwrap()
            .write_all(b"one\nfindme\n")
            .unwrap();
        let response = unsafe {
            call(
                oc_grep,
                serde_json::json!({
                    "pattern": "findme",
                    "path": dir.to_string_lossy(),
                    "mode": "content",
                    "glob": null,
                    "context_lines": null
                }),
            )
        };
        assert_eq!(response["status"], "ok");
        assert_eq!(response["result"]["mode"], "content");
        assert_eq!(response["result"]["matches"][0]["line_number"], 2);
    }

    #[test]
    fn oc_grep_reports_invalid_pattern() {
        let response = unsafe {
            call(
                oc_grep,
                serde_json::json!({ "pattern": "(", "path": ".", "mode": "content", "glob": null, "context_lines": null }),
            )
        };
        assert_eq!(response["error"]["code"], "invalid_pattern");
    }

    #[test]
    fn oc_grep_never_spawns_a_subprocess() {
        // The engine is embedded: the source imports no process/command API. This
        // test documents the invariant; the absence of a spawn is enforced by the
        // dependency set (no `std::process::Command`, no `rg`).
        let source = include_str!("grep.rs");
        assert!(
            !source.contains("std::process::Command"),
            "grep must not spawn a subprocess"
        );
        assert!(
            !source.contains("Command::new"),
            "grep must not spawn a subprocess"
        );
    }
}
