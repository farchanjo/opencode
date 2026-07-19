// DDD role: ValueObject
// Package: ffi.enums
// Core bounded enums for the Feature 010 native FFI contract — the response status
// discriminant, the closed error-code set mapped one-to-one to the TypeScript tool
// failures, the six filesystem/text tool names reimplemented natively, and the grep
// output-mode set (FR6, FR14, FR15, C3, C4). The status discriminates the #FfiResponse
// envelope; `ok` is read as `status == "ok"` (C3). The error code is closed for V1 and a
// new code requires an ABI-minor bump (C4, C7). Telemetry, backend and platform enums
// live in enums-telemetry.cue. Every enum is a ValueObject.

package ffi.enums

// FfiStatus discriminates a native FFI response; a caught panic maps to "error" (FR15, C3).
#FfiStatus: "ok" | "error"

// FfiErrorCode is the closed error taxonomy mapped one-to-one to the TypeScript ToolFailures (FR15, C4).
#FfiErrorCode: "invalid_request" | "not_found" | "not_a_file" | "binary_file" | "malformed_utf8" | "offset_out_of_range" | "media_limit" | "ambiguous_match" | "no_match" | "context_mismatch" | "invalid_pattern" | "io_error" | "internal_panic"

// NativeToolName enumerates the six filesystem/text tools reimplemented in opencode-tools-ffi (FR1, C7).
#NativeToolName: "read" | "write" | "edit" | "apply_patch" | "glob" | "grep"

// GrepOutputMode is the closed grep output-mode set at parity with the reference (FR6, AC7).
#GrepOutputMode: "files_with_matches" | "content" | "count"
