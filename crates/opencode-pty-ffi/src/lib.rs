//! opencode-pty-ffi — native PTY entry points (Feature 010).
//!
//! The five synchronous, `catch_unwind`-wrapped entry points — `oc_pty_spawn`,
//! `oc_pty_resize`, `oc_pty_kill`, `oc_pty_wait`, `oc_pty_close` — atop
//! `portable-pty` and `libc`, with **no Tokio or async runtime** on this boundary
//! (FR8, FR9, FR11, C6, C9, C11, C12). Each call performs a single syscall's worth of
//! work; async master-fd IO lives entirely on Bun's event loop (C9), so no FFI call
//! sits on the IO hot path.
//!
//! This crate also re-exports the shared, panic-safe ABI handshake surface
//! (`oc_free`, `oc_abi_version`, `oc_version`, and the debug-gated `oc_alloc_stats`)
//! from `opencode-ffi-abi`, so the compiled `cdylib` is loadable and passes the
//! loader's ABI handshake.

use std::ffi::c_char;

use opencode_ffi_abi::{protect, FfiError, FfiErrorCode};
use serde::de::DeserializeOwned;

mod session;

opencode_ffi_abi::export_ffi_abi!();

/// Deserialize a PTY request from the raw FFI request buffer. A null pointer, a
/// non-UTF-8 buffer, or a malformed JSON body yields the typed `invalid_request`
/// error rather than panicking (FR14, Security: input validation).
///
/// # Safety
/// `req_ptr` must either be null or point to `req_len` initialized bytes owned by the
/// caller for the duration of the call; the bytes are only read, never retained.
fn parse_request<T: DeserializeOwned>(req_ptr: *const u8, req_len: usize) -> Result<T, FfiError> {
    if req_ptr.is_null() || req_len == 0 {
        return Err(FfiError::new(
            FfiErrorCode::InvalidRequest,
            "empty FFI request buffer",
        ));
    }
    // SAFETY: the loader marshals a JSON request buffer of exactly `req_len` bytes and
    // keeps it alive across the call; we only read it here.
    let bytes = unsafe { std::slice::from_raw_parts(req_ptr, req_len) };
    serde_json::from_slice(bytes)
        .map_err(|err| FfiError::new(FfiErrorCode::InvalidRequest, format!("{err}")))
}

/// `oc_pty_spawn` — allocate a PTY and spawn a session-leader child with a controlling
/// terminal, returning `{ session_id, pid, master_fd }` (FR8, C9, C11, AC8).
///
/// # Safety
/// See [`parse_request`]: `req_ptr`/`req_len` describe a caller-owned request buffer.
#[no_mangle]
pub unsafe extern "C" fn oc_pty_spawn(req_ptr: *const u8, req_len: usize) -> *mut c_char {
    protect(move || {
        let request: session::SpawnRequest = parse_request(req_ptr, req_len)?;
        session::spawn(request)
    })
}

/// `oc_pty_resize` — apply a new terminal window via `TIOCSWINSZ` (FR9, C12).
///
/// # Safety
/// See [`parse_request`]: `req_ptr`/`req_len` describe a caller-owned request buffer.
#[no_mangle]
pub unsafe extern "C" fn oc_pty_resize(req_ptr: *const u8, req_len: usize) -> *mut c_char {
    protect(move || {
        let request: session::ResizeRequest = parse_request(req_ptr, req_len)?;
        session::resize(request)
    })
}

/// `oc_pty_kill` — deliver one signal to the child's process group via `killpg`
/// (FR9, NFR5, C11, C12, AC9).
///
/// # Safety
/// See [`parse_request`]: `req_ptr`/`req_len` describe a caller-owned request buffer.
#[no_mangle]
pub unsafe extern "C" fn oc_pty_kill(req_ptr: *const u8, req_len: usize) -> *mut c_char {
    protect(move || {
        let request: session::KillRequest = parse_request(req_ptr, req_len)?;
        session::kill(request)
    })
}

/// `oc_pty_wait` — non-blocking `waitpid(WNOHANG)` for a session (FR9, C12).
///
/// # Safety
/// See [`parse_request`]: `req_ptr`/`req_len` describe a caller-owned request buffer.
#[no_mangle]
pub unsafe extern "C" fn oc_pty_wait(req_ptr: *const u8, req_len: usize) -> *mut c_char {
    protect(move || {
        let request: session::WaitRequest = parse_request(req_ptr, req_len)?;
        session::wait(request)
    })
}

/// `oc_pty_close` — idempotent single-owner teardown of a session (FR9, C9, C10, C12).
///
/// # Safety
/// See [`parse_request`]: `req_ptr`/`req_len` describe a caller-owned request buffer.
#[no_mangle]
pub unsafe extern "C" fn oc_pty_close(req_ptr: *const u8, req_len: usize) -> *mut c_char {
    protect(move || {
        let request: session::CloseRequest = parse_request(req_ptr, req_len)?;
        session::close(request)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

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
    fn spawn_wait_close_round_trip_through_the_entry_points() {
        let spawned = unsafe {
            call(
                oc_pty_spawn,
                serde_json::json!({
                    "command": "/bin/echo",
                    "args": ["ffi"],
                    "cwd": null,
                    "env": [{ "name": "PATH", "value": "/usr/bin:/bin" }],
                    "window": { "cols": 80, "rows": 24 },
                }),
            )
        };
        assert_eq!(spawned["status"], "ok");
        let session_id = spawned["result"]["session_id"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(spawned["result"]["pid"].as_i64().unwrap() > 0);
        let master_fd = spawned["result"]["master_fd"].as_i64().unwrap() as i32;

        // Poll the non-blocking wait until the child exits.
        let mut exited = false;
        for _ in 0..2000 {
            let waited =
                unsafe { call(oc_pty_wait, serde_json::json!({ "session_id": session_id })) };
            assert_eq!(waited["status"], "ok");
            if waited["result"]["exited"].as_bool().unwrap() {
                exited = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(exited, "child never exited");

        unsafe { libc::close(master_fd) };
        let closed = unsafe {
            call(
                oc_pty_close,
                serde_json::json!({ "session_id": session_id }),
            )
        };
        assert_eq!(closed["status"], "ok");
    }

    #[test]
    fn spawn_rejects_an_empty_request() {
        let ptr = unsafe { oc_pty_spawn(std::ptr::null(), 0) };
        let text = unsafe { std::ffi::CStr::from_ptr(ptr) }
            .to_str()
            .unwrap()
            .to_string();
        opencode_ffi_abi::free(ptr);
        let response: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(response["error"]["code"], "invalid_request");
    }

    #[test]
    fn no_async_runtime_is_linked_on_this_boundary() {
        // FR11 / C6: the PTY boundary is synchronous — no Tokio, mio, or reader thread.
        // The needles are assembled at runtime so this scan never matches its own
        // source literal (self-reference), only a real import/use of the runtime.
        let async_runtime = format!("{}{}", "tok", "io::");
        let poller = format!("{}{}", "mio", "::");
        let session_src = include_str!("session.rs");
        let lib_src = include_str!("lib.rs");
        for src in [session_src, lib_src] {
            assert!(
                !src.contains(&async_runtime),
                "no async runtime on the FFI boundary"
            );
            assert!(
                !src.contains(&poller),
                "no reader-thread poller on the boundary"
            );
        }
    }
}
