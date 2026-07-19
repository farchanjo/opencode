/**
 * Feature 010 — Application Ports (Native Rust FFI Tools and PTY Integration)
 *
 * These interfaces are the TypeScript-side view of the FFI boundary Feature
 * 010 adds. They are implemented by the wrapper/fallback layer
 * (`packages/core/src/tool/native/{loader,pty-registry,pty-reader,
 * <tool>.native}.ts`) and consumed by each of the six filesystem/text
 * built-in tools (`read`, `write`, `edit`, `apply_patch`, `glob`, `grep`) and
 * by `bash.ts`'s opt-in `pty: true` route. Native code (`crates/**`) is
 * authoritative for nothing at runtime: tool identity/registration stays with
 * ToolRegistry, the permission/approval gate stays in TypeScript (Feature 007
 * PermissionV2) and is evaluated before every native call and every PTY
 * spawn, tool-output identity stays with Feature 005 OutputSpool, and
 * telemetry stays content-free (ADR-0001) — none of that authority is
 * re-declared here.
 *
 * Wire-shape source of truth: the `doc/arch/schemas/ffi/` corpus
 * (`#FfiResponse`, `#FfiError`, `#PtySpawnResult`, `#PtySessionEntry`,
 * `#NativeToolBackend`, `#NativeToolName`, `#FfiStatus`) across the
 * `ffi.enums` / `ffi.shared` / `ffi.envelope` / `ffi.tools` / `ffi.pty` /
 * `ffi.config` packages; this file is the forward TypeScript mirror those CUE
 * files match one-to-one. Rust symbol names are cited inline (`oc_read`,
 * `oc_pty_spawn`, `oc_free`, `oc_abi_version`, …) so each port method traces
 * back to the exact `extern "C"` entry point it marshals (plan.md "FFI
 * envelope and symbol surface", C7).
 */

import type { Effect } from "effect"

// =============================================================================
// Identifiers
// =============================================================================

/** Opaque, non-guessable handle `oc_pty_spawn` mints; the TS registry is the sole owner (C10). */
export type PtySessionId = string

// =============================================================================
// Closed enums (wire shape: the CUE scaffold above; `#NativeToolBackend`,
// `#NativeToolName`, `#FfiStatus` mirrored verbatim, never redeclared in CUE)
// =============================================================================

/** Which implementation served one tool call; `"typescript"` is always the safe floor (C2, C8). */
export type NativeBackend = "native" | "typescript"

/** The six filesystem/text built-ins reimplemented natively (FR1-FR7). Mirrors CUE `#NativeToolName`. */
export type NativeToolName = "read" | "write" | "edit" | "apply_patch" | "glob" | "grep"

/** Discriminates the FFI envelope; mirrors CUE `#FfiStatus`. `"ok"` is read wherever the spec prose says `ok: true` (C3). */
export type FfiStatus = "ok" | "error"

/** Runtime platform gate; native `dlopen` is attempted only on darwin/linux, never on win32 (C19). */
export type Platform = "darwin" | "linux" | "win32"

/**
 * Stable `native_unavailable` gap reasons (C14), mirroring the Feature 006
 * `milvus_unavailable` posture. Bounded telemetry label, never free text.
 */
export type NativeUnavailableGapReason = "library_missing" | "dlopen_failed" | "abi_mismatch" | "disabled"

/**
 * The closed `error.code` enum every `oc_<name>` entry point may return (C4).
 * Each value maps one-to-one to an existing TypeScript `ToolFailure`; the
 * wrapper re-emits the identical message so native and fallback are
 * indistinguishable to the model. New codes require an ABI-minor bump.
 */
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

/**
 * PTY session lifecycle states (plan.md "PTY session lifecycle" state
 * diagram; C9-C12). The TS registry (`pty-registry.ts`) is the sole owner of
 * this state, never native code.
 */
export type PtySessionState = "spawning" | "streaming" | "terminating" | "escalating" | "reaping" | "closed"

/** Signal `oc_pty_kill` delivers to the child's process group; SIGTERM is the default, SIGKILL is the TS-driven escalation (C12). */
export type PtySignal = "SIGTERM" | "SIGKILL"

// =============================================================================
// FFI envelope wire mirrors (wire shape: CUE `#FfiResponse` / `#FfiError`, normative — C3)
// =============================================================================

/** Mirrors CUE `#FfiError`. Never a numeric code, never a backtrace/pointer/address (C3, Security). */
export interface FfiError {
  readonly code: FfiErrorCode
  readonly message: string
}

/**
 * Mirrors CUE `#FfiResponse`, the JSON envelope every `extern "C" fn
 * oc_<name>(req_ptr, req_len) -> *mut c_char` returns. A caught panic
 * (`catch_unwind`) is serialized as `{ status: "error", error: { code:
 * "internal_panic", ... } }` — it never unwinds across the boundary (C3,
 * FR16).
 */
export type FfiEnvelope<TResult> = { readonly status: "ok"; readonly result: TResult } | { readonly status: "error"; readonly error: FfiError }

/**
 * The `oc_abi_version()` / `oc_version()` handshake payload (C7). The loader
 * asserts `abiVersion` equals the expected ABI major on every load; a
 * mismatch is treated as unloadable (`native_unavailable`, reason
 * `abi_mismatch`). `caps` surfaces the introspected parity constants
 * (`MAX_READ_LINES`, `MAX_READ_BYTES`, …) so a parity test can assert Rust
 * and TypeScript never silently drift (C16).
 */
export interface FfiVersionInfo {
  readonly abiVersion: number
  readonly semver: string
  readonly caps: Readonly<Record<string, number>>
}

/** Mirrors CUE `#PtySpawnResult`, the handle `oc_pty_spawn` returns. `masterFd` transfers wholly to Bun on return (C9). */
export interface PtySessionHandle {
  readonly sessionId: PtySessionId
  readonly pid: number
  readonly masterFd: number
}

// =============================================================================
// Per-tool request/result wire mirrors (JSON body inside the FfiEnvelope
// `result`/`error`; symbol names cited per method — C7, C16)
// =============================================================================

/** `oc_read` request (FR1). 1-based offset/limit windowing, mirroring `read-filesystem.ts`. */
export interface NativeReadRequest {
  readonly path: string
  readonly offset?: number
  readonly limit?: number
}

/** `oc_read` result. `truncated`/`next` mirror the paged-read contract exactly (FR1, AC2, C16). */
export interface NativeReadResult {
  readonly content: string
  readonly lineCount: number
  readonly truncated: boolean
  readonly next?: number
}

/** `oc_write` request (FR2). Atomic write-and-rename; never a partial destination (AC3). */
export interface NativeWriteRequest {
  readonly path: string
  readonly content: string
}

export interface NativeWriteResult {
  readonly bytesWritten: number
}

/** `oc_edit` request (FR3). Exact string replacement with uniqueness validation. */
export interface NativeEditRequest {
  readonly path: string
  readonly oldString: string
  readonly newString: string
  readonly replaceAll: boolean
}

export interface NativeEditResult {
  readonly occurrencesReplaced: number
}

/** `oc_apply_patch` request (FR4). Multi-hunk parse + apply; `context_mismatch` on any hunk mismatch (AC5). */
export interface NativeApplyPatchRequest {
  readonly path: string
  readonly patch: string
}

export interface NativeApplyPatchResult {
  readonly hunksApplied: number
}

/** `oc_glob` request (FR5). `.gitignore`-aware via `ignore`/`globset`; mtime-desc sort (C13). */
export interface NativeGlobRequest {
  readonly pattern: string
  readonly cwd: string
}

export interface NativeGlobResult {
  readonly paths: readonly string[]
}

/** `oc_grep` request (FR6). Embedded `grep-searcher`/`grep-regex`/`grep-matcher`; NEVER spawns external `rg`. */
export interface NativeGrepRequest {
  readonly pattern: string
  readonly cwd: string
  readonly mode: GrepOutputMode
  readonly contextLines?: number
}

/** One match record, shape varies by {@link GrepOutputMode} (`content` mode populates `line`/`text`; `count` mode populates none). */
export interface NativeGrepMatch {
  readonly path: string
  readonly line?: number
  readonly text?: string
}

export interface NativeGrepResult {
  readonly mode: GrepOutputMode
  readonly matches: readonly NativeGrepMatch[]
  readonly countByPath?: Readonly<Record<string, number>> // populated only in "count" mode
}

// =============================================================================
// PTY request/result wire mirrors (symbol names: oc_pty_spawn/resize/kill/wait/close — C7, C9, C11, C12)
// =============================================================================

/** `oc_pty_spawn` request (FR8, C11). The permission gate MUST be evaluated in TypeScript before this call ever fires (FR13). */
export interface PtySpawnRequest {
  readonly cmd: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly cols: number
  readonly rows: number
}

/** `oc_pty_resize` request (`TIOCSWINSZ`, C12). */
export interface PtyResizeRequest {
  readonly sessionId: PtySessionId
  readonly cols: number
  readonly rows: number
}

/** `oc_pty_kill` request — one `killpg` per call; the TS side schedules the SIGTERM->3s->SIGKILL escalation, never Rust (C12). */
export interface PtyKillRequest {
  readonly sessionId: PtySessionId
  readonly signal: PtySignal
}

/** `oc_pty_wait` result — non-blocking `waitpid(WNOHANG)` (C12). */
export interface PtyWaitResult {
  readonly exited: boolean
  readonly exitCode?: number
  readonly signal?: string
}

/** `oc_pty_close` request — idempotent teardown honoring the single-owner fd contract (C9, C10). */
export interface PtyCloseRequest {
  readonly sessionId: PtySessionId
}

/**
 * TS-side PTY session registry entry (`pty-registry.ts`, C10). `stream` is
 * the `node:net.Socket({ fd })` instance wrapping `masterFd` under
 * `O_NONBLOCK`; kept opaque here because its concrete type is a Bun/Node
 * runtime object, not a wire shape.
 */
export interface PtySessionEntry {
  readonly sessionId: PtySessionId
  readonly pid: number
  readonly masterFd: number
  readonly pgid: number
  readonly state: PtySessionState
  readonly stream: unknown
}

// =============================================================================
// NativeToolPort — per-tool invoke with per-call native-vs-TS selection (FR18, FR19, C2, C4, C8)
// =============================================================================

/** Which backend actually served a call and why, attached to every result for the content-free telemetry seam (FR24, C14). */
export interface NativeToolInvokeMeta {
  readonly tool: NativeToolName
  readonly backend: NativeBackend
  readonly gapReason?: NativeUnavailableGapReason // set only when backend is "typescript" because native was unavailable
}

export type NativeToolError =
  | { readonly type: "ffi_error"; readonly code: FfiErrorCode; readonly message: string } // C4 one-to-one ToolFailure mapping
  | { readonly type: "native_unavailable"; readonly reason: NativeUnavailableGapReason } // C14, mirrors milvus_unavailable
  | { readonly type: "not_implemented" }

/**
 * The per-tool invoke surface each `<tool>.native.ts` wrapper implements.
 * Backend selection is resolved once at first use (lazy `dlopen`, cached),
 * then every call chooses native-vs-TypeScript from the cached, Config-gated
 * capability (C2, C8); the model-facing `Tool.make` shape above this port is
 * unchanged. Symbol names: `oc_read`, `oc_write`, `oc_edit`, `oc_apply_patch`,
 * `oc_glob`, `oc_grep` (C7).
 */
export interface NativeToolPort {
  readonly read: (input: NativeReadRequest) => Effect.Effect<readonly [NativeReadResult, NativeToolInvokeMeta], NativeToolError>
  readonly write: (input: NativeWriteRequest) => Effect.Effect<readonly [NativeWriteResult, NativeToolInvokeMeta], NativeToolError>
  readonly edit: (input: NativeEditRequest) => Effect.Effect<readonly [NativeEditResult, NativeToolInvokeMeta], NativeToolError>
  readonly applyPatch: (input: NativeApplyPatchRequest) => Effect.Effect<readonly [NativeApplyPatchResult, NativeToolInvokeMeta], NativeToolError>
  /** Falls back to the `Ripgrep.Service` seam (external `rg` spawn), not directly to a bespoke TS glob (C5). */
  readonly glob: (input: NativeGlobRequest) => Effect.Effect<readonly [NativeGlobResult, NativeToolInvokeMeta], NativeToolError>
  /** Falls back to the `Ripgrep.Service` seam (external `rg` spawn) (C5). */
  readonly grep: (input: NativeGrepRequest) => Effect.Effect<readonly [NativeGrepResult, NativeToolInvokeMeta], NativeToolError>
}

// =============================================================================
// NativeLoaderPort — probe/load/abiHandshake/dispose (FR18, FR19, FR21, C1, C7, C14, C19)
// =============================================================================

/** Which cdylib crate a loader operation targets. */
export type NativeCrate = "tools" | "pty"

export interface NativeLoaderProbeInput {
  readonly crate: NativeCrate
  readonly platform: Platform
}

export interface NativeLoaderProbeOutput {
  readonly available: boolean
  readonly path?: string // set only when available; env-override or bundled discovery path (C1)
  readonly gapReason?: NativeUnavailableGapReason
}

/** Opaque loaded-library handle; the wrapper never inspects it beyond passing it back to `abiHandshake`/`dispose`. */
export interface NativeLoaderHandle {
  readonly crate: NativeCrate
  readonly path: string
}

export type NativeLoaderError =
  | { readonly type: "library_missing" }
  | { readonly type: "dlopen_failed"; readonly reason: string }
  | { readonly type: "abi_mismatch"; readonly expectedMajor: number; readonly actualMajor: number }
  | { readonly type: "disabled" } // experimental.nativeTools / experimental.nativePty is off (C2)
  | { readonly type: "not_implemented" }

/**
 * `loader.ts`'s discovery/dlopen/handshake surface (C1, C7, C8). Discovery
 * order: env override (`OPENCODE_NATIVE_LIB_DIR` / `OPENCODE_TOOLS_FFI_PATH` /
 * `OPENCODE_PTY_FFI_PATH`) -> bundled `packages/core/native/<platform>-<arch>/`
 * -> `native_unavailable`. `win32` never reaches `load` (`probe` alone
 * reports unavailable, C19). Lazy: `load` runs once per crate per process,
 * cached; every subsequent call reuses the cached handle.
 */
export interface NativeLoaderPort {
  readonly probe: (input: NativeLoaderProbeInput) => Effect.Effect<NativeLoaderProbeOutput, never>
  readonly load: (input: NativeLoaderProbeInput) => Effect.Effect<NativeLoaderHandle, NativeLoaderError>
  /** Calls `oc_abi_version()` / `oc_version()`; a major mismatch is treated as unloadable (C7). */
  readonly abiHandshake: (handle: NativeLoaderHandle) => Effect.Effect<FfiVersionInfo, NativeLoaderError>
  readonly dispose: (handle: NativeLoaderHandle) => Effect.Effect<void, never>
}

// =============================================================================
// PtyPort — spawn/resize/kill/wait/close with the single-owner fd contract (FR8-FR13, C9-C12, C20)
// =============================================================================

export type PtyError =
  | { readonly type: "session_not_found"; readonly sessionId: PtySessionId }
  | { readonly type: "ffi_error"; readonly code: FfiErrorCode; readonly message: string }
  | { readonly type: "native_unavailable"; readonly reason: NativeUnavailableGapReason }
  | { readonly type: "already_closed"; readonly sessionId: PtySessionId }
  | { readonly type: "permission_denied" } // guards FR13: permission.assert MUST run in TS before spawn, never here
  | { readonly type: "not_implemented" }

/**
 * The PTY lifecycle surface `bash.ts` `pty: true` calls through
 * `pty-registry.ts`. **Security invariant (FR13, C20): the caller MUST
 * evaluate `permission.assert` in TypeScript before invoking `spawn` —
 * this port never evaluates, caches, or bypasses a permission decision
 * itself; it only executes an already-approved spawn.** `masterFd` in the
 * {@link PtySpawnResult} transfers wholly to Bun; `close` is idempotent and
 * honors the single-owner fd contract (C9, C10). Symbol names: `oc_pty_spawn`,
 * `oc_pty_resize`, `oc_pty_kill`, `oc_pty_wait`, `oc_pty_close` (C7).
 */
export interface PtyPort {
  readonly spawn: (input: PtySpawnRequest) => Effect.Effect<PtySessionHandle, PtyError>
  readonly resize: (input: PtyResizeRequest) => Effect.Effect<void, PtyError>
  /** One `killpg` per call; TS schedules the SIGTERM->3s-grace->SIGKILL escalation, mirroring `bash.ts` `forceKillAfter` (C12). */
  readonly kill: (input: PtyKillRequest) => Effect.Effect<void, PtyError>
  readonly wait: (input: { readonly sessionId: PtySessionId }) => Effect.Effect<PtyWaitResult, PtyError>
  /** Idempotent; the master fd is closed exactly once, by Bun, its sole owner (C9, C10). */
  readonly close: (input: PtyCloseRequest) => Effect.Effect<void, PtyError>
}

// =============================================================================
// Parity-harness contract — ParityFixture, ParityRunResult (FR7, FR20, C13, AC1-AC7, AC11)
// =============================================================================

/** Undefined-ordering-tie normalization the harness applies before the byte-identity assertion (C13). */
export type ParityTieBreak =
  | { readonly kind: "glob"; readonly order: "mtime_desc_then_path" }
  | { readonly kind: "grep"; readonly order: "path_then_line_then_offset" }

/**
 * One shared fixture the parity suite runs through both backends
 * (`packages/core/test/fixtures/native-parity/`, C13). Covers binary files,
 * CRLF vs LF, >50 KiB paged reads, 2000-char line truncation, multi-hunk
 * patches with matching/non-matching context, zero/one/many `edit`
 * occurrences, and non-ASCII UTF-8.
 */
export interface ParityFixture {
  readonly id: string
  readonly tool: NativeToolName
  readonly request: NativeReadRequest | NativeWriteRequest | NativeEditRequest | NativeApplyPatchRequest | NativeGlobRequest | NativeGrepRequest
  readonly description: string // content-free description of the edge case covered, never fixture file bytes
}

/**
 * One parity assertion outcome (FR20). `byteIdentical` is computed after
 * {@link ParityTieBreak} normalization so only ties the TypeScript reference
 * itself leaves undefined are neutralized, never a real divergence.
 */
export interface ParityRunResult {
  readonly fixtureId: string
  readonly tool: NativeToolName
  readonly nativeResult: FfiEnvelope<unknown>
  readonly typescriptResult: FfiEnvelope<unknown>
  readonly byteIdentical: boolean
  readonly tieBreakApplied?: ParityTieBreak
}

/** The leak-stress counterpart (C18): `oc_alloc_stats()` introspection plus a bounded RSS ceiling, both asserted at rest. */
export interface LeakStressResult {
  readonly callCount: number
  readonly allocated: number
  readonly freed: number
  readonly peakRssBytes: number
  readonly rssCeilingBytes: number
}
