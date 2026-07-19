//! opencode-ffi-abi — the shared, synchronous, panic-safe, leak-free FFI boundary
//! for Feature 010 (the first Rust in the repository).
//!
//! This `rlib` is linked into the `opencode-tools-ffi` and `opencode-pty-ffi`
//! `cdylib` crates; it is never `dlopen`ed directly. It owns:
//!
//! * the CUE-normative [`FfiResponse`] envelope (`doc/arch/schemas/ffi/envelope.cue`)
//!   with its typed [`FfiError`] and closed 13-value [`FfiErrorCode`] taxonomy
//!   (`doc/arch/schemas/ffi/enums.cue`);
//! * [`protect`], the `catch_unwind` wrapper every entry point uses — any unwind
//!   becomes an `internal_panic` error envelope, never crossing the boundary and
//!   never carrying a backtrace, pointer, or address (FR16, C3);
//! * [`free`], the sole deallocation path (exported as `oc_free`), plus the atomic
//!   allocation/free counters that back [`AllocStats`] (C18);
//! * the [`abi_version`] / [`version_json`] / [`alloc_stats_json`] handshake surface
//!   (`oc_abi_version` / `oc_version` / `oc_alloc_stats`), and the parity constants
//!   mirrored from the TypeScript references and test-locked here (C7, C16).
//!
//! The `cdylib` crates re-export the shared ABI symbols via [`export_ffi_abi`].

use std::ffi::{c_char, CString};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// ABI / semver constants
// ---------------------------------------------------------------------------

/// The ABI major the loader asserts on `oc_abi_version` (FR14, C7). A breaking
/// wire change bumps this; a new `error.code` requires an ABI-minor bump (C4).
pub const ABI_VERSION: u32 = 1;

/// The crate semver surfaced by `oc_version` (FR14, C7).
pub const SEMVER: &str = "0.1.0";

// ---------------------------------------------------------------------------
// Parity constants — mirrored from TypeScript, test-locked here (C7, C16, FR1)
//
// The TypeScript constants remain the conceptual source of truth; these mirrors
// are asserted against their exact values in the unit tests below, and the four
// AbiCaps are surfaced through `oc_version` so the TS-vs-Rust parity test (T008)
// can prove no drift.
// ---------------------------------------------------------------------------

/// `read-filesystem.ts` `MAX_READ_LINES`.
pub const MAX_READ_LINES: u64 = 2_000;
/// `read-filesystem.ts` `MAX_READ_BYTES` (50 KiB).
pub const MAX_READ_BYTES: u64 = 50 * 1024;
/// `read-filesystem.ts` `MAX_MEDIA_INGEST_BYTES` (20 MiB).
pub const MAX_MEDIA_INGEST_BYTES: u64 = 20 * 1024 * 1024;
/// `read-filesystem.ts` `MAX_LINE_LENGTH`.
pub const MAX_LINE_LENGTH: u64 = 2_000;
/// `read-filesystem.ts` line-truncation suffix (`MAX_LINE_SUFFIX`).
pub const LINE_TRUNCATION_SUFFIX: &str = "... (line truncated to 2000 chars)";
/// Non-printable ratio above which a file is treated as binary (FR1, C16).
pub const BINARY_NON_PRINTABLE_RATIO: f64 = 0.3;
/// `bash.ts` `MAX_CAPTURE_BYTES` — the PTY output-sink cap (1 MiB).
pub const MAX_CAPTURE_BYTES: u64 = 1024 * 1024;
/// `bash.ts` `forceKillAfter` grace, in seconds, before the SIGKILL escalation.
pub const FORCE_KILL_AFTER_SECS: u64 = 3;

// ---------------------------------------------------------------------------
// Allocation accounting (C18)
// ---------------------------------------------------------------------------

static ALLOCATED: AtomicU64 = AtomicU64::new(0);
static FREED: AtomicU64 = AtomicU64::new(0);

/// Total responses allocated through the boundary since process start (C18).
pub fn allocations() -> u64 {
    ALLOCATED.load(Ordering::Relaxed)
}

/// Total responses freed through [`free`] since process start (C18).
pub fn frees() -> u64 {
    FREED.load(Ordering::Relaxed)
}

// ---------------------------------------------------------------------------
// Envelope types — mirror doc/arch/schemas/ffi/{enums,envelope}.cue one-to-one
// ---------------------------------------------------------------------------

/// The closed error taxonomy, mapped one-to-one to the TypeScript `ToolFailure`
/// set (`ffi.enums.#FfiErrorCode`, FR15, C4). `snake_case` serialization yields
/// the exact wire strings (`invalid_request`, `not_a_file`, `io_error`, ...).
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum FfiErrorCode {
    InvalidRequest,
    NotFound,
    NotAFile,
    BinaryFile,
    MalformedUtf8,
    OffsetOutOfRange,
    MediaLimit,
    AmbiguousMatch,
    NoMatch,
    ContextMismatch,
    InvalidPattern,
    IoError,
    InternalPanic,
}

/// The typed error payload returned when `status` is `"error"` (`#FfiError`, FR15, C4).
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct FfiError {
    pub code: FfiErrorCode,
    pub message: String,
}

impl FfiError {
    /// Construct a typed error with an arbitrary message.
    pub fn new(code: FfiErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// The generic `internal_panic` error — no backtrace, pointer, or address (FR16, C3).
    fn internal_panic() -> Self {
        Self::new(FfiErrorCode::InternalPanic, "internal error")
    }
}

/// The JSON envelope every entry point returns, discriminated by `status`
/// (`#FfiResponse`, FR14, C3). Serializes to `{ "status": "ok", "result": … }`
/// or `{ "status": "error", "error": { "code", "message" } }`.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum FfiResponse {
    Ok {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
    },
    Error {
        error: FfiError,
    },
}

/// The introspected read caps surfaced by `oc_version`, test-locked to TypeScript
/// (`#AbiCaps`, C7, C16).
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct AbiCaps {
    pub max_read_lines: u64,
    pub max_read_bytes: u64,
    pub max_line_length: u64,
    pub max_media_ingest_bytes: u64,
}

impl AbiCaps {
    /// The caps mirrored from the TypeScript constants (C16).
    pub fn current() -> Self {
        Self {
            max_read_lines: MAX_READ_LINES,
            max_read_bytes: MAX_READ_BYTES,
            max_line_length: MAX_LINE_LENGTH,
            max_media_ingest_bytes: MAX_MEDIA_INGEST_BYTES,
        }
    }
}

/// The `oc_version` handshake payload (`#FfiVersion`, FR14, C7).
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct FfiVersion {
    pub abi_version: u32,
    pub semver: String,
    pub caps: AbiCaps,
}

/// The debug-gated `oc_alloc_stats` payload (`#AllocStats`, FR17, C18).
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct AllocStats {
    pub allocated: u64,
    pub freed: u64,
}

// ---------------------------------------------------------------------------
// Panic-safe / leak-free boundary
// ---------------------------------------------------------------------------

/// The last-resort envelope used when serialization itself fails; contains no NUL
/// so its `CString` conversion is infallible.
const PANIC_FALLBACK_JSON: &str =
    r#"{"status":"error","error":{"code":"internal_panic","message":"internal error"}}"#;

/// Serialize an owned JSON string into a freshly allocated, NUL-terminated C string
/// and bump the allocation counter (C18). Hidden: called only by [`protect`] and by
/// the [`export_ffi_abi`]-generated `oc_version` / `oc_alloc_stats` entry points.
#[doc(hidden)]
pub fn __alloc_cstring(json: String) -> *mut c_char {
    let cstring = CString::new(json)
        .unwrap_or_else(|_| CString::new(PANIC_FALLBACK_JSON).expect("fallback has no NUL"));
    ALLOCATED.fetch_add(1, Ordering::Relaxed);
    cstring.into_raw()
}

/// Serialize a response envelope, falling back to [`PANIC_FALLBACK_JSON`] if that
/// (practically impossible) serialization ever fails.
fn respond(response: &FfiResponse) -> *mut c_char {
    let json = serde_json::to_string(response).unwrap_or_else(|_| PANIC_FALLBACK_JSON.to_string());
    __alloc_cstring(json)
}

/// Run a tool body under `catch_unwind` and marshal its outcome into the CUE
/// `#FfiResponse` envelope (FR14, FR16, C3). Any panic becomes an `internal_panic`
/// error with a generic message — no backtrace, pointer, or address crosses the
/// boundary. The returned pointer MUST be released exactly once via [`free`].
pub fn protect<F>(body: F) -> *mut c_char
where
    F: FnOnce() -> Result<Value, FfiError> + std::panic::UnwindSafe,
{
    let response = match std::panic::catch_unwind(body) {
        Ok(Ok(result)) => FfiResponse::Ok {
            result: Some(result),
        },
        Ok(Err(error)) => FfiResponse::Error { error },
        Err(_) => FfiResponse::Error {
            error: FfiError::internal_panic(),
        },
    };
    respond(&response)
}

/// The sole deallocation path (exported as `oc_free`). Releases a pointer minted by
/// the boundary and bumps the free counter; a null pointer is a no-op and each
/// pointer must be freed exactly once (FR17, C7, C18).
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn free(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: `ptr` was produced by `CString::into_raw` in `__alloc_cstring` and is
    // released exactly once here; reclaiming ownership drops the allocation.
    unsafe {
        drop(CString::from_raw(ptr));
    }
    FREED.fetch_add(1, Ordering::Relaxed);
}

// ---------------------------------------------------------------------------
// Handshake payload builders (exported as oc_abi_version / oc_version / oc_alloc_stats)
// ---------------------------------------------------------------------------

/// The ABI major the loader compares against (exported as `oc_abi_version`, FR14, C7).
pub fn abi_version() -> u32 {
    ABI_VERSION
}

/// The `oc_version` handshake JSON: ABI major, semver, and the introspected caps (FR14, C7).
pub fn version_json() -> String {
    let version = FfiVersion {
        abi_version: ABI_VERSION,
        semver: SEMVER.to_string(),
        caps: AbiCaps::current(),
    };
    serde_json::to_string(&version).unwrap_or_else(|_| PANIC_FALLBACK_JSON.to_string())
}

/// The `oc_alloc_stats` JSON: `{ allocated, freed }` at the moment of the call (C18).
pub fn alloc_stats_json() -> String {
    let stats = AllocStats {
        allocated: allocations(),
        freed: frees(),
    };
    serde_json::to_string(&stats).unwrap_or_else(|_| PANIC_FALLBACK_JSON.to_string())
}

// ---------------------------------------------------------------------------
// Shared extern "C" surface — re-exported by each cdylib
// ---------------------------------------------------------------------------

/// Emit the shared `#[no_mangle]` ABI symbols (`oc_free`, `oc_abi_version`,
/// `oc_version`, and — under the `alloc-stats` feature — `oc_alloc_stats`) that
/// every `cdylib` in this workspace exports. Invoke once at the crate root of each
/// `cdylib`. The `oc_alloc_stats` gate resolves against the *invoking* crate's
/// `alloc-stats` feature, which must forward to `opencode-ffi-abi/alloc-stats`.
#[macro_export]
macro_rules! export_ffi_abi {
    () => {
        #[no_mangle]
        pub extern "C" fn oc_free(ptr: *mut ::std::ffi::c_char) {
            $crate::free(ptr);
        }

        #[no_mangle]
        pub extern "C" fn oc_abi_version() -> u32 {
            $crate::abi_version()
        }

        #[no_mangle]
        pub extern "C" fn oc_version() -> *mut ::std::ffi::c_char {
            $crate::__alloc_cstring($crate::version_json())
        }

        #[cfg(feature = "alloc-stats")]
        #[no_mangle]
        pub extern "C" fn oc_alloc_stats() -> *mut ::std::ffi::c_char {
            $crate::__alloc_cstring($crate::alloc_stats_json())
        }
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;

    /// Reclaim a boundary pointer and return its JSON payload as an owned String.
    fn take(ptr: *mut c_char) -> String {
        assert!(!ptr.is_null(), "boundary returned a null pointer");
        let text = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap().to_string();
        free(ptr);
        text
    }

    #[test]
    fn success_envelope_matches_cue_shape() {
        let ptr = protect(|| Ok(serde_json::json!({ "content": "hi" })));
        assert_eq!(take(ptr), r#"{"status":"ok","result":{"content":"hi"}}"#);
    }

    #[test]
    fn error_envelope_matches_cue_shape() {
        let ptr = protect(|| Err(FfiError::new(FfiErrorCode::NotFound, "nope")));
        assert_eq!(
            take(ptr),
            r#"{"status":"error","error":{"code":"not_found","message":"nope"}}"#,
        );
    }

    #[test]
    fn every_error_code_serializes_to_its_wire_string() {
        let pairs = [
            (FfiErrorCode::InvalidRequest, "invalid_request"),
            (FfiErrorCode::NotFound, "not_found"),
            (FfiErrorCode::NotAFile, "not_a_file"),
            (FfiErrorCode::BinaryFile, "binary_file"),
            (FfiErrorCode::MalformedUtf8, "malformed_utf8"),
            (FfiErrorCode::OffsetOutOfRange, "offset_out_of_range"),
            (FfiErrorCode::MediaLimit, "media_limit"),
            (FfiErrorCode::AmbiguousMatch, "ambiguous_match"),
            (FfiErrorCode::NoMatch, "no_match"),
            (FfiErrorCode::ContextMismatch, "context_mismatch"),
            (FfiErrorCode::InvalidPattern, "invalid_pattern"),
            (FfiErrorCode::IoError, "io_error"),
            (FfiErrorCode::InternalPanic, "internal_panic"),
        ];
        for (code, wire) in pairs {
            assert_eq!(
                serde_json::to_value(code).unwrap(),
                Value::String(wire.into())
            );
        }
    }

    #[test]
    fn panic_body_yields_internal_panic_without_leaking_details() {
        let ptr = protect(|| -> Result<Value, FfiError> { panic!("secret backtrace 0xdeadbeef") });
        let json = take(ptr);
        assert!(json.contains(r#""code":"internal_panic""#), "got {json}");
        assert!(!json.contains("secret"), "panic body leaked: {json}");
        assert!(!json.contains("0xdeadbeef"), "address leaked: {json}");
    }

    #[test]
    fn alloc_counter_returns_to_at_rest_after_free() {
        let before = allocations();
        let freed_before = frees();
        let ptr = protect(|| Ok(serde_json::json!({ "x": 1 })));
        assert_eq!(allocations(), before + 1, "one allocation per response");
        free(ptr);
        assert_eq!(frees(), freed_before + 1, "one free per oc_free");
        // Net allocation growth is fully matched by frees for this round trip.
        assert_eq!(allocations() - before, frees() - freed_before);
    }

    #[test]
    fn free_is_a_no_op_on_null() {
        let before = frees();
        free(std::ptr::null_mut());
        assert_eq!(frees(), before, "null free must not touch the counter");
    }

    #[test]
    fn abi_version_is_stable() {
        assert_eq!(abi_version(), 1);
        assert_eq!(abi_version(), ABI_VERSION);
    }

    #[test]
    fn version_json_carries_semver_and_introspected_caps() {
        let version: FfiVersion = serde_json::from_str(&version_json()).unwrap();
        assert_eq!(version.abi_version, ABI_VERSION);
        assert_eq!(version.semver, SEMVER);
        assert_eq!(version.caps, AbiCaps::current());
        // Caps are test-locked to the TypeScript source-of-truth values (C16).
        assert_eq!(version.caps.max_read_lines, 2_000);
        assert_eq!(version.caps.max_read_bytes, 51_200);
        assert_eq!(version.caps.max_line_length, 2_000);
        assert_eq!(version.caps.max_media_ingest_bytes, 20_971_520);
    }

    #[test]
    fn alloc_stats_json_is_balanced_at_rest() {
        // Drain any in-flight pointer this test makes, then assert the reported
        // counters agree with the live accessors.
        let ptr = protect(|| Ok(Value::Null));
        free(ptr);
        let stats: AllocStats = serde_json::from_str(&alloc_stats_json()).unwrap();
        assert_eq!(stats.allocated, allocations());
        assert_eq!(stats.freed, frees());
    }

    #[test]
    fn parity_constants_are_locked_to_typescript_anchors() {
        assert_eq!(MAX_READ_LINES, 2_000);
        assert_eq!(MAX_READ_BYTES, 51_200);
        assert_eq!(MAX_MEDIA_INGEST_BYTES, 20_971_520);
        assert_eq!(MAX_LINE_LENGTH, 2_000);
        assert_eq!(LINE_TRUNCATION_SUFFIX, "... (line truncated to 2000 chars)");
        assert_eq!(BINARY_NON_PRINTABLE_RATIO, 0.3);
        assert_eq!(MAX_CAPTURE_BYTES, 1_048_576);
        assert_eq!(FORCE_KILL_AFTER_SECS, 3);
    }
}
