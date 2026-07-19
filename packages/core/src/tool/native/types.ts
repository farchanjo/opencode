/**
 * Feature 010 — shared TypeScript wire types for the native FFI boundary.
 *
 * Forward mirror of `doc/arch/schemas/ffi/*.cue` and the `contracts/ports.ts`
 * scaffold: the `#FfiResponse` envelope, the closed error taxonomy, the bounded
 * `native_unavailable` gap reasons, and the per-tool request/result shapes for the
 * two Phase-2 tools (`read`, `grep`). Native code is authoritative for nothing;
 * these are the shapes the wrapper/fallback layer marshals across `bun:ffi`.
 */

/** Which implementation served one tool call; `"typescript"` is always the safe floor (C2, C8). */
export type NativeBackend = "native" | "typescript"

/** The six filesystem/text built-ins reimplemented natively (FR1-FR7). Mirrors CUE `#NativeToolName`. */
export type NativeToolName = "read" | "write" | "edit" | "apply_patch" | "glob" | "grep"

/** Which cdylib crate a loader operation targets. */
export type NativeCrate = "tools" | "pty"

/** Runtime platform gate; native `dlopen` is attempted only on darwin/linux, never on win32 (C19). */
export type Platform = "darwin" | "linux" | "win32"

/** Stable `native_unavailable` gap reasons (C14), mirroring the Feature 006 `milvus_unavailable` posture. */
export type NativeUnavailableGapReason = "library_missing" | "dlopen_failed" | "abi_mismatch" | "disabled"

/** The closed `error.code` enum every `oc_<name>` entry point may return (C4). */
export type FfiErrorCode =
  | "invalid_request"
  | "not_found"
  | "not_a_file"
  | "binary_file"
  | "malformed_utf8"
  | "offset_out_of_range"
  | "media_limit"
  | "ambiguous_match"
  | "no_match"
  | "context_mismatch"
  | "invalid_pattern"
  | "io_error"
  | "internal_panic"

/** `grep`'s three output modes (FR6, AC7); `oc_grep` and the TS fallback share this vocabulary. */
export type GrepOutputMode = "files_with_matches" | "content" | "count"

/** Mirrors CUE `#FfiError`. Never a numeric code, never a backtrace/pointer/address (C3, Security). */
export interface FfiError {
  readonly code: FfiErrorCode
  readonly message: string
}

/** Mirrors CUE `#FfiResponse`, the JSON envelope every entry point returns (C3, FR16). */
export type FfiEnvelope<TResult> =
  | { readonly status: "ok"; readonly result: TResult }
  | { readonly status: "error"; readonly error: FfiError }

/** The `oc_abi_version()` / `oc_version()` handshake payload (C7). */
export interface FfiVersionInfo {
  readonly abiVersion: number
  readonly semver: string
  readonly caps: Readonly<Record<string, number>>
}

/** `oc_read` request (FR1). 1-based offset/limit windowing, mirroring `read-filesystem.ts`. */
export interface NativeReadRequest {
  readonly path: string
  readonly offset?: number | null
  readonly limit?: number | null
}

/** `oc_read` result — mirrors CUE `#ReadResult` (snake_case on the wire). */
export interface NativeReadResult {
  readonly content: string
  readonly line_count: number
  readonly byte_count: number
  readonly truncated: boolean
  readonly next: number | null
}

/** `oc_grep` request (FR6). Embedded engine; NEVER spawns external `rg`. */
export interface NativeGrepRequest {
  readonly pattern: string
  readonly path?: string | null
  readonly mode: GrepOutputMode
  readonly glob?: string | null
  readonly context_lines?: number | null
}

/** One content-mode grep match — mirrors CUE `#GrepMatch`. */
export interface NativeGrepMatch {
  readonly path: string
  readonly line_number: number
  readonly byte_offset: number
  readonly text: string
}

/** One count-mode grep entry — mirrors CUE `#GrepFileCount`. */
export interface NativeGrepFileCount {
  readonly path: string
  readonly count: number
}

/** `oc_grep` result — mirrors CUE `#GrepResult` (only the mode-relevant collection populated). */
export interface NativeGrepResult {
  readonly mode: GrepOutputMode
  readonly matches: readonly NativeGrepMatch[] | null
  readonly files: readonly string[] | null
  readonly counts: readonly NativeGrepFileCount[] | null
}

/** `oc_write` request (FR2). Atomic create/overwrite, mirroring `write.ts`. */
export interface NativeWriteRequest {
  readonly path: string
  readonly content: string
}

/** `oc_write` result — mirrors CUE `#WriteResult`. */
export interface NativeWriteResult {
  readonly created: boolean
  readonly byte_count: number
}

/** `oc_edit` request (FR3). Exact string replacement with uniqueness, mirroring `edit.ts`. */
export interface NativeEditRequest {
  readonly path: string
  readonly old_string: string
  readonly new_string: string
  readonly replace_all: boolean
}

/** `oc_edit` result — mirrors CUE `#EditResult`. */
export interface NativeEditResult {
  readonly replacements: number
}

/** `oc_apply_patch` request (FR4). Multi-hunk apply, mirroring `apply-patch.ts`. */
export interface NativeApplyPatchRequest {
  readonly patch: string
  readonly cwd?: string | null
}

/** `oc_apply_patch` result — mirrors CUE `#ApplyPatchResult`. */
export interface NativeApplyPatchResult {
  readonly files_changed: number
  readonly hunks_applied: number
}

/** `oc_glob` request (FR5). `.gitignore`-aware, mtime-sorted, mirroring the `glob` tool. */
export interface NativeGlobRequest {
  readonly pattern: string
  readonly cwd?: string | null
  readonly limit?: number | null
}

/** `oc_glob` result — mirrors CUE `#GlobResult` (mtime-desc paths + size-cap truncation). */
export interface NativeGlobResult {
  readonly paths: readonly string[]
  readonly truncated: boolean
}

/** Which backend actually served a call and why, for the content-free telemetry seam (FR24, C14). */
export interface NativeInvokeMeta {
  readonly backend: NativeBackend
  readonly gapReason?: NativeUnavailableGapReason
}

/** One PTY environment variable — mirrors CUE `ffi.pty.#EnvEntry` (FR8). */
export interface NativePtyEnvEntry {
  readonly name: string
  readonly value: string
}

/** Terminal window size applied at spawn and via `TIOCSWINSZ` — mirrors CUE `#WindowSize` (FR9, C12). */
export interface NativePtyWindow {
  readonly cols: number
  readonly rows: number
}

/** `oc_pty_spawn` request — mirrors CUE `#PtySpawnRequest` (FR8, C11). */
export interface NativePtySpawnRequest {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string | null
  readonly env: readonly NativePtyEnvEntry[]
  readonly window: NativePtyWindow
}

/** `oc_pty_spawn` result — mirrors CUE `#PtySpawnResult`; `master_fd` transfers wholly to Bun (FR8, C9). */
export interface NativePtySpawnResult {
  readonly session_id: string
  readonly pid: number
  readonly master_fd: number
}

/** `oc_pty_resize` request — mirrors CUE `#PtyResizeRequest` (FR9, C12). */
export interface NativePtyResizeRequest {
  readonly session_id: string
  readonly window: NativePtyWindow
}

/** `oc_pty_kill` request — mirrors CUE `#PtyKillRequest`; one `killpg` per call (FR9, C12). */
export interface NativePtyKillRequest {
  readonly session_id: string
  readonly signal: number
}

/** `oc_pty_wait` / `oc_pty_close` request — mirrors CUE `#PtyWaitRequest` / `#PtyCloseRequest` (FR9, C12). */
export interface NativePtySessionRequest {
  readonly session_id: string
}

/** `oc_pty_wait` result — mirrors CUE `#PtyWaitResult` (non-blocking `waitpid(WNOHANG)`, FR9, C12). */
export interface NativePtyWaitResult {
  readonly exited: boolean
  readonly exit_code: number | null
  readonly signal: number | null
}
