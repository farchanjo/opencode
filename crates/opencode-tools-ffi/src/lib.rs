//! opencode-tools-ffi — native filesystem/text tool entry points (Feature 010).
//!
//! Bootstrap skeleton (T001). The per-tool entry points — `oc_read`, `oc_write`,
//! `oc_edit`, `oc_apply_patch`, `oc_glob`, `oc_grep` — are authored in the Phase 2
//! and Phase 3 slices (T004, T005, T009–T012). Each will wrap its body in
//! [`opencode_ffi_abi::protect`] and return the CUE `#FfiResponse` envelope.
//!
//! This crate already re-exports the shared, panic-safe ABI handshake surface
//! (`oc_free`, `oc_abi_version`, `oc_version`, and the debug-gated
//! `oc_alloc_stats`) from `opencode-ffi-abi`, so the compiled `cdylib` is loadable
//! and passes the loader's ABI handshake from day one.

opencode_ffi_abi::export_ffi_abi!();
