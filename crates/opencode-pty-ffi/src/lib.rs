//! opencode-pty-ffi — native PTY entry points (Feature 010).
//!
//! Bootstrap skeleton (T001). The five synchronous, `catch_unwind`-wrapped entry
//! points — `oc_pty_spawn`, `oc_pty_resize`, `oc_pty_kill`, `oc_pty_wait`,
//! `oc_pty_close` — are authored in the Phase 4 slice (T013) atop `portable-pty`
//! and `libc`, with no Tokio or async runtime on this boundary (FR11, C6).
//!
//! This crate already re-exports the shared, panic-safe ABI handshake surface
//! (`oc_free`, `oc_abi_version`, `oc_version`, and the debug-gated
//! `oc_alloc_stats`) from `opencode-ffi-abi`, so the compiled `cdylib` is loadable
//! and passes the loader's ABI handshake from day one.

opencode_ffi_abi::export_ffi_abi!();
