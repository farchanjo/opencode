// DDD role: ValueObject
// Package: ffi.enums
// Loader, discovery and content-free telemetry enums for Feature 010 (FR18, FR19, FR24,
// C1, C14, C19). The backend records which implementation served a call; the gap reason is
// the bounded stable enum on the typed native_unavailable capability gap mirroring the
// Feature 006 milvus_unavailable posture (C14). The tool label widens the native tool set
// with `pty` for backend-selection and PTY lifecycle counters; no file content, path,
// command string or session id is ever a label (FR24, ADR-0001). The platform gate loads
// native only on darwin and linux; win32 always falls back (C19). Every enum is a
// ValueObject.

package ffi.enums

// NativeToolBackend records which implementation served a tool call for content-free telemetry (FR24, C14).
#NativeToolBackend: "native" | "typescript"

// GapReason is the bounded reason on the typed native_unavailable capability gap (FR19, C14).
#GapReason: "library_missing" | "dlopen_failed" | "abi_mismatch" | "disabled"

// TelemetryToolLabel is the bounded tool label for backend-selection and PTY counters (FR24, C14).
#TelemetryToolLabel: "read" | "write" | "edit" | "apply_patch" | "glob" | "grep" | "pty"

// Platform is the loader host gate; native dlopen occurs only on darwin and linux (FR22, C19).
#Platform: "darwin" | "linux" | "win32"

// DiscoverySource is the resolved rung of the discovery ladder that located a library (FR21, C1).
#DiscoverySource: "env_override" | "bundled" | "absent"

// PtyLifecycleEvent is the bounded PTY session lifecycle counter axis (FR24, C14).
#PtyLifecycleEvent: "spawn" | "kill" | "close"
