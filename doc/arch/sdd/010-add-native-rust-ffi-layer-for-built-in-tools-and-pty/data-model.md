# Data Model: Native Rust FFI Tools and PTY Integration (Feature 010)

Feature: [010 Native Rust FFI Tools and PTY Integration](spec.md)
Plan: [plan.md](plan.md)
Research: [research.md](research.md)
Contracts: [contracts/ports.ts](contracts/ports.ts) (the forward TypeScript mirror of this model)
ADR: [ADR-0010 Native Rust FFI Layer for Built-in Tools and PTY](../../adr/0010-add-native-rust-ffi-layer-for-built-in-tools-and-pty.md) (proposed; Rust `cdylib` via `bun:ffi` `dlopen`)
Status: draft (finalized in the tasks phase; the bundled subpath layout, the `build:native`
copy layout, the stress iteration count, the RSS ceiling, and the pinned toolchain channel
are provisional plan constants with named acceptance hooks — AC11, AC13, AC14, AC18)

**Feature 010 introduces no store of record.** The FFI boundary is a synchronous,
panic-safe, leak-free JSON wire, and every shape below is a **transient value object**
marshalled across it — never a second tool registry, permission authority, output plane, or
telemetry pipeline. Tool identity/registration stays with ToolRegistry; the
permission/approval gate stays in TypeScript (Feature 007 PermissionV2) and is evaluated
before every native call and every PTY spawn; tool-output identity stays with Feature 005
OutputSpool; telemetry stays content-free (Feature 001 / ADR-0001). The one shape with
lifecycle identity — the PTY session — lives in a **TypeScript-side registry**, never in
native code (C10, C20). No envelope field and no telemetry label carries file content, a
path beyond what the tool already returns, a patch body, a command string, or a session id
(FR24, C14). Native code is authoritative for nothing at runtime.

## Schema surface conventions

Every wire shape is defined once in the CUE corpus under `doc/arch/schemas/ffi/` and mirrored
one-to-one by the forward TypeScript interfaces in [contracts/ports.ts](contracts/ports.ts)
and by the Rust `serde` request/response structs in `crates/opencode-tools-ffi` and
`crates/opencode-pty-ffi`. The corpus follows the `doc/arch/schemas/{mcp,semantic}/`
conventions exactly:

- Six dotted packages partition the surface: `ffi.enums` (bounded enums), `ffi.shared`
  (identity, numeric, count, text, and flag ValueObjects), `ffi.envelope` (the response
  envelope and version handshake), `ffi.tools` (the six tool request/result shapes),
  `ffi.pty` (the session entity, spawn/wait shapes, and the five PTY requests), and
  `ffi.config` (the loader flags, discovery outcome, and telemetry labels).
- Every scalar is a named ValueObject on a checked base (`string & !=""`, `int & >0`,
  `bool`); no struct field is a bare primitive.
- First-class collections wrap a named element (`#GrepMatchSet: [...#GrepMatch]`,
  `#GlobPathSet: [...ids.#FilePath]`); no bare arrays.
- Optional and absent axes use a null union (`values.#LineNumber | null`).
- Each file carries a `// DDD role:` header; the one Entity (`#PtySessionEntry`) sits alone
  in `session.cue` with its cohesive parts split into `session-parts.cue`; every file holds
  at most ten definitions and every struct at most seven fields.
- The `serde` Rust side uses `snake_case` field names identical to the CUE keys, so the JSON
  request buffer and response C string are byte-for-byte the CUE `#FfiResponse` shape (C3).

The rest of this document walks the surface package by package and closes with the parameters
table and the CUE ↔ TypeScript ↔ Rust traceability matrix.

---

## FFI envelope and version handshake (FR14, FR15, FR16, C3, C7, C16, C18)

Every `extern "C" fn oc_<name>(req_ptr, req_len) -> *mut c_char` returns the CUE-normative
`#FfiResponse`, discriminated by `status`. Success carries `result` (the tool-specific
payload); failure carries the typed `#FfiError`. The spec body's informal `{ ok: true }` /
`{ ok: false }` prose maps to `status == "ok"` (C3). A caught panic is serialized as
`status: "error"` with `code: "internal_panic"` and a generic message — it never unwinds
across the boundary and never carries a backtrace, pointer, or address (FR16, C3). All request
and response strings are UTF-8; every response C string is freed exactly once through
`oc_free` after the wrapper copies it (FR17, C7). Mirrors `envelope.cue`.

| CUE def | Shape | Purpose |
| ------- | ----- | ------- |
| `#FfiError` | `{ code: #FfiErrorCode, message: #ErrorMessage }` | the typed error half; never numeric, never a backtrace (FR15, C4) |
| `#FfiResult` | open `{...}` narrowed per tool | the tool-specific success payload the `result` key carries (FR14) |
| `#FfiResponse` | `{ status; if ok result?; if error error }` | the envelope every entry point returns (FR14, C3) |
| `#AbiCaps` | `{ max_read_lines, max_read_bytes, max_line_length, max_media_ingest_bytes }` | the introspected read caps surfaced by `oc_version`, test-locked to the TypeScript source of truth (C7, C16) |
| `#FfiVersion` | `{ abi_version, semver, caps: #AbiCaps }` | the `oc_abi_version()` / `oc_version()` handshake payload; a major mismatch is unloadable → `native_unavailable` (C7) |
| `#AllocStats` | `{ allocated, freed }` | the debug-gated `oc_alloc_stats()` payload; `allocated == freed` at rest gates the leak stress (FR17, C18) |

The handshake caps (`#AbiCaps`) mirror the `read-filesystem.ts` constants
(`MAX_READ_LINES = 2000`, `MAX_READ_BYTES = 51200`, `MAX_LINE_LENGTH = 2000`,
`MAX_MEDIA_INGEST_BYTES = 20 MiB`) so a parity test asserts the Rust `const` values equal the
TypeScript source and the duplication never drifts silently (C16, AC1, AC2).

---

## Error code taxonomy (FR15, C4)

`#FfiErrorCode` is a closed thirteen-value enum in `enums.cue`. Each value maps one-to-one to
an existing TypeScript `ToolFailure`; the wrapper re-emits the identical message so native and
fallback are indistinguishable to the model (C4, C8). The enum is closed for V1 — a new code
requires an ABI-minor bump (C7). Mirrors `enums.cue`.

| `#FfiErrorCode` | TypeScript `ToolFailure` | Raised by |
| --------------- | ------------------------ | --------- |
| `invalid_request` | request-parse failure | every entry point on malformed/oversized JSON (Security: input validation) |
| `not_found` | file-not-found | `oc_read`, `oc_edit`, `oc_apply_patch` |
| `not_a_file` | not-a-regular-file | `oc_read` |
| `binary_file` | `ReadTool.BinaryFileError` | `oc_read` binary detection (FR1) |
| `malformed_utf8` | `ReadTool.MalformedUtf8Error` | `oc_read` fatal decode (FR1) |
| `offset_out_of_range` | `ReadTool.OffsetOutOfRangeError` | `oc_read` windowing (FR1, AC2) |
| `media_limit` | media-ingest cap exceeded | `oc_read` (`MAX_MEDIA_INGEST_BYTES`) |
| `ambiguous_match` | `edit` "multiple matches" | `oc_edit` (>1 without replace-all, AC4) |
| `no_match` | `edit` "could not find" | `oc_edit` (zero occurrences, AC4) |
| `context_mismatch` | `apply_patch` context-mismatch | `oc_apply_patch` (applies nothing, AC5) |
| `invalid_pattern` | `Ripgrep.InvalidPatternError` | `oc_grep`, `oc_glob` (AC7) |
| `io_error` | generic IO failure | any tool on a filesystem error |
| `internal_panic` | generic panic envelope | `catch_unwind` on any entry point (FR16, AC12) |

---

## Per-tool request and result payloads (FR1–FR7, C13, C16)

The six tool request shapes (`tool-requests.cue`) and result shapes (`tool-results.cue`) are
field-exact mirrors of the TypeScript tool params and outputs, so the native backend is
transparent to callers and to the model (FR18, C8). Each native result is structurally and
byte-identical to its TypeScript reference on the shared fixtures, ignoring only ordering ties
the references leave undefined (FR7, NFR1, C13). Grep and glob compose the collections in
`tool-result-parts.cue`; the byte offset is the deterministic secondary tie-break key so the
byte-identity assertion neutralizes only undefined ties (C13, AC7).

| Tool | Request (`tool-requests.cue`) | Result (`tool-results.cue`) | Parity anchor |
| ---- | ----------------------------- | --------------------------- | ------------- |
| `read` | `#ReadRequest { path, offset?, limit? }` | `#ReadResult { content, line_count, byte_count, truncated, next? }` | `read-filesystem.ts` (FR1, AC2, C16) |
| `write` | `#WriteRequest { path, content }` | `#WriteResult { created, byte_count }` | `write.ts` atomic write-and-rename (FR2, AC3) |
| `edit` | `#EditRequest { path, old_string, new_string, replace_all }` | `#EditResult { replacements }` | `edit.ts` zero/one/many + replaceAll (FR3, AC4) |
| `apply_patch` | `#ApplyPatchRequest { patch, cwd? }` | `#ApplyPatchResult { files_changed, hunks_applied }` | `apply-patch.ts` multi-hunk + context match (FR4, AC5) |
| `glob` | `#GlobRequest { pattern, cwd?, limit? }` | `#GlobResult { paths: #GlobPathSet, truncated }` | `ripgrep.ts` glob; `ignore` + `globset`, mtime-desc (FR5, AC6) |
| `grep` | `#GrepRequest { pattern, path?, mode, glob?, context_lines? }` | `#GrepResult { mode, matches?, files?, counts? }` | `ripgrep.ts` grep; embedded `grep-*`, no external `rg` (FR6, AC7) |

The grep result populates exactly the mode-specific collection: `files: #GlobPathSet` in
`files_with_matches` mode, `matches: #GrepMatchSet` in `content` mode, and
`counts: #GrepFileCountSet` in `count` mode; the other two are null (`tool-result-parts.cue`).
One `#GrepMatch` carries `{ path, line_number, byte_offset, text }`; one `#GrepFileCount`
carries `{ path, count }` (FR6, AC7).

---

## PTY session shapes and the single-owner fd contract (FR8–FR12, C9–C12)

The PTY surface is one Entity plus its cohesive value objects and five request shapes. The
Entity — `#PtySessionEntry` (`session.cue`) — is the TypeScript-side registry record keyed by
the opaque, non-guessable `session_id`; it owns each session's lifecycle and guarantees the
single-owner fd contract (one close per fd, no double-free, no use-after-close). Native code
never retains, reads, writes, or closes the master fd after `oc_pty_spawn` returns; Bun is the
sole owner and closes it exactly once (FR8, FR10, C9, C10). Mirrors `session.cue`,
`session-parts.cue`, and `pty-requests.cue`.

| CUE def | Shape | Role |
| ------- | ----- | ---- |
| `#PtySessionEntry` (Entity) | `{ id: session_id, pid, master_fd, pgid }` | the TS registry entry owning one PTY lifecycle (FR8, C10) |
| `#PtySpawnResult` | `{ session_id, pid, master_fd }` | the `oc_pty_spawn` success payload; the master fd transfers wholly to Bun (FR8, C9) |
| `#WindowSize` | `{ cols, rows }` | the terminal window applied via `TIOCSWINSZ` (FR9, C12) |
| `#PtyWaitResult` | `{ exited, exit_code?, signal? }` | the non-blocking `waitpid(WNOHANG)` outcome (FR9, C12) |
| `#CommandArgv` | `[...#CommandArg]` | the first-class PTY argv collection (FR8, C11) |
| `#EnvEntry` / `#EnvEntrySet` | `{ name, value }` / `[...#EnvEntry]` | the first-class PTY environment collection (FR8) |
| `#PtySpawnRequest` | `{ command, args, cwd?, env, window }` | the `oc_pty_spawn` request; the permission gate runs first, in TS (FR13, C20) |
| `#PtyResizeRequest` | `{ session_id, window }` | the `oc_pty_resize` request (FR9, C12) |
| `#PtyKillRequest` | `{ session_id, signal }` | the `oc_pty_kill` request; one `killpg` per call (FR9, C12) |
| `#PtyWaitRequest` | `{ session_id }` | the `oc_pty_wait` request (FR9, C12) |
| `#PtyCloseRequest` | `{ session_id }` | the idempotent `oc_pty_close` request (FR9, C9, C12) |

`oc_pty_spawn` calls `setsid` so the child is a session leader in its own process group; the
pgid equals the child pid. `oc_pty_kill` delivers one caller-supplied signal to that process
group so the full subprocess tree is terminated with no orphans (FR9, NFR5, C11, C12, AC9).
The default flow sends `SIGTERM`; the **TypeScript side** schedules the `SIGKILL` escalation
after a 3-second grace mirroring `bash.ts` `forceKillAfter`, because phase 1 forbids an async
runtime inside the FFI boundary (FR11, C12). Async master-fd IO stays on Bun's event loop via
`node:net.Socket({ fd })` with `O_NONBLOCK`; no FFI call sits on the IO hot path (FR10, NFR4,
C9). The `stream` handle in the TS registry (`pty-registry.ts`) is the live `Socket`, a
runtime object kept opaque to the wire shape (C10).

---

## Loader, config, and discovery shapes (FR18, FR19, FR21, C1, C2, C19)

The loader owns discovery, the flag gate, the lazy `dlopen`, the ABI handshake, and the typed
`native_unavailable` gap. Native execution is off by default behind two experimental Config
booleans, so a present library changes nothing until the operator opts in (C2). The discovery
ladder resolves in fixed order: env override → bundled
`packages/core/native/<platform>-<arch>/` → typed `native_unavailable` + silent TypeScript
fallback (C1). On `win32` the loader never attempts `dlopen` (C19). Mirrors `config.cue` and
the `enums-telemetry.cue` platform/source enums.

| CUE def | Shape | Role |
| ------- | ----- | ---- |
| `#NativeFlags` | `{ native_tools, native_pty }` | the two experimental opt-in booleans, default false (FR19, C2) |
| `#DiscoveryOutcome` | `{ platform, source, backend, gap_reason }` | the resolved ladder rung, host platform, selected backend, and typed gap reason (FR18, C1, C19) |
| `#Platform` | `darwin \| linux \| win32` | the loader host gate; native `dlopen` only on darwin/linux (FR22, C19) |
| `#DiscoverySource` | `env_override \| bundled \| absent` | the resolved discovery rung (FR21, C1) |
| `#NativeToolBackend` | `native \| typescript` | which implementation served a call (FR24, C14) |
| `#GapReason` | `library_missing \| dlopen_failed \| abi_mismatch \| disabled` | the bounded reason on the typed `native_unavailable` gap (FR19, C14) |

The `native_unavailable` gap is telemetry-only in V1 — it mirrors the Feature 006
`milvus_unavailable` posture and does not surface to the Feature 007 operator control plane as
a reserved capability (C14). The four other tools (`read`, `write`, `edit`, `apply_patch`)
fall back to their TypeScript references directly; `glob`/`grep` fall back to the
`Ripgrep.Service` seam (external `rg` spawn), which is the only fallback path for those two
(C5).

---

## Telemetry label shapes (FR24, C14, ADR-0001)

Telemetry reuses the ADR-0001 / Feature 001 content-free posture. Backend-selection and
`native_unavailable` signals carry bounded enum labels only; PTY lifecycle counters carry a
bounded event axis. No file content, path, patch body, command string, or session id is ever a
label (FR24, C14, AC17). Mirrors `config.cue`.

| CUE def | Labels | Signal |
| ------- | ------ | ------ |
| `#NativeTelemetryLabels` | `{ tool, backend, gap_reason }` | per-call backend selection + the typed gap (FR24, C14) |
| `#PtyLifecycleLabels` | `{ event, backend }` | PTY spawn/kill/close counters (FR24, C14) |
| `#TelemetryToolLabel` | the six tool names + `pty` | the bounded tool axis (FR24, C14) |
| `#PtyLifecycleEvent` | `spawn \| kill \| close` | the bounded PTY lifecycle axis (FR24, C14) |

---

## Parameters

Every provisional contract is a plan constant with a named acceptance hook; ADR-0010 and the
tasks phase fix final values (plan Non-goals). Crate versions and FFI symbol names are **not**
provisional — they are pinned in the plan. No value is a hidden default: each is an explicit
data constant on its domain module, never inlined into an algorithm. No parameter widens into
a telemetry label (FR24, C14).

| Parameter | Provisional value | Scope | Acceptance hook |
| --------- | ----------------- | ----- | --------------- |
| `MAX_READ_LINES` | `2000` (mirrors `read-filesystem.ts`, test-locked) | per read page | FR1, C16, AC2 |
| `MAX_READ_BYTES` | `51200` / 50 KiB (mirrors `read-filesystem.ts`) | per read page | FR1, C16, AC2 |
| `MAX_LINE_LENGTH` | `2000` + `... (line truncated to 2000 chars)` suffix | per read line | FR1, C16, AC2 |
| `MAX_MEDIA_INGEST_BYTES` | `20971520` / 20 MiB (mirrors `read-filesystem.ts`) | per read | FR1, C16 |
| `MAX_CAPTURE_BYTES` (PTY sink) | `1048576` / 1 MiB (mirrors `bash.ts`) | per PTY session | FR23, C20, AC16 |
| `forceKillAfter` (PTY grace) | `Duration.seconds(3)` (mirrors `bash.ts`, TS-driven) | per PTY kill | FR9, C12, AC9 |
| `abi_major` | `1` (loader asserts equality; mismatch → `native_unavailable`) | per load | FR14, C7, AC18 |
| `discovery_order` | env override → bundled → `native_unavailable` | per crate load | FR21, C1, AC13, AC14 |
| `bundled_subpath` | `packages/core/native/<platform>-<arch>/` | per crate load | FR21, C1, AC13, AC18 |
| `native_tools_default` / `native_pty_default` | `false` (opt-in; presence never changes behavior) | per process | FR19, C2, AC13, AC16 |
| `platform_gate` | darwin/linux native; win32 always TypeScript | per load | FR22, C19, AC13, AC16 |
| `glob_tie_break` | mtime-desc, then path | per glob | FR5, C13, AC6 |
| `grep_tie_break` | path, then line, then absolute byte offset | per grep | FR6, C13, AC7 |
| `stress_iterations` | ≥ 100k `oc_*` calls, each freed via `oc_free` | leak stress | FR17, FR20, C18, AC11 |
| `rss_ceiling` | bounded process RSS ceiling at rest | leak stress | FR17, NFR3, C18, AC11 |
| `toolchain_channel` | `rust-toolchain.toml` `channel = "1.83.0"`, edition 2021 | build/CI | FR21, C15, AC18 |
| `build_command` | `bun run build:native` → `cargo build --release` + copy (never install-time) | build | FR21, C17, AC18 |

Crate versions pinned exactly in the plan — `serde 1.0.229`, `serde_json 1.0.150`,
`ignore 0.4.30`, `globset 0.4.19`, `grep-searcher 0.1.17`, `grep-regex 0.1.14`,
`grep-matcher 0.1.9`, `portable-pty 0.9.0`, `libc 0.2.186` — are not re-declared here (plan
"Crate dependency versions").

---

## Cross-artifact traceability (CUE ↔ TypeScript ↔ Rust)

The CUE corpus is the normative wire shape; [contracts/ports.ts](contracts/ports.ts) is the
forward TypeScript mirror; the Rust `serde` structs are the native serialize/deserialize half.
All three carry identical `snake_case` JSON keys so the request buffer and response C string
are byte-for-byte the `#FfiResponse` shape (C3).

| CUE def (`doc/arch/schemas/ffi/`) | TypeScript mirror (`contracts/ports.ts`) | Rust `serde` struct/enum (`crates/**`) | Requirements / clarifications |
| --------------------------------- | ---------------------------------------- | -------------------------------------- | ----------------------------- |
| `#FfiStatus` / `#FfiError` / `#FfiResponse` (`envelope.cue`, `enums.cue`) | `FfiStatus` / `FfiError` / `FfiEnvelope<T>` | `FfiResponse<T>` in `opencode-ffi-abi` | FR14, FR15, C3 |
| `#FfiErrorCode` (`enums.cue`) | `FfiErrorCode` | `FfiErrorCode` enum in `opencode-ffi-abi` | FR15, C4 |
| `#FfiVersion` / `#AbiCaps` (`envelope.cue`) | `FfiVersionInfo` | `FfiVersion` in `opencode-ffi-abi` | FR14, C7, C16 |
| `#AllocStats` (`envelope.cue`) | `LeakStressResult` (allocated/freed) | `AllocStats` in `opencode-ffi-abi` | FR17, C18 |
| `#ReadRequest` / `#ReadResult` (`tool-*.cue`) | `NativeReadRequest` / `NativeReadResult` | `read` req/res in `opencode-tools-ffi` | FR1, AC2, C16 |
| `#WriteRequest` / `#WriteResult` | `NativeWriteRequest` / `NativeWriteResult` | `write` req/res in `opencode-tools-ffi` | FR2, AC3 |
| `#EditRequest` / `#EditResult` | `NativeEditRequest` / `NativeEditResult` | `edit` req/res in `opencode-tools-ffi` | FR3, AC4 |
| `#ApplyPatchRequest` / `#ApplyPatchResult` | `NativeApplyPatchRequest` / `NativeApplyPatchResult` | `apply_patch` req/res in `opencode-tools-ffi` | FR4, AC5 |
| `#GlobRequest` / `#GlobResult` / `#GlobPathSet` | `NativeGlobRequest` / `NativeGlobResult` | `glob` req/res in `opencode-tools-ffi` | FR5, AC6, C13 |
| `#GrepRequest` / `#GrepResult` / `#GrepMatch` / `#GrepFileCount` | `NativeGrepRequest` / `NativeGrepResult` / `NativeGrepMatch` | `grep` req/res in `opencode-tools-ffi` | FR6, AC7, C13 |
| `#PtySpawnResult` (`session-parts.cue`) | `PtySessionHandle` | `PtySpawnResult` in `opencode-pty-ffi` | FR8, C9 |
| `#PtySessionEntry` (`session.cue`, Entity) | `PtySessionEntry` (+ `state`, `stream`) | — (TS registry only, C10) | FR8, C10 |
| `#PtySpawnRequest` / `#WindowSize` / `#CommandArgv` / `#EnvEntrySet` | `PtySpawnRequest` | `PtySpawnRequest` in `opencode-pty-ffi` | FR8, C11 |
| `#PtyResizeRequest` / `#PtyKillRequest` / `#PtyWaitResult` / `#PtyCloseRequest` | `PtyResizeRequest` / `PtyKillRequest` / `PtyWaitResult` / `PtyCloseRequest` | PTY req/res in `opencode-pty-ffi` | FR9, C12 |
| `#NativeFlags` / `#DiscoveryOutcome` (`config.cue`) | `NativeLoaderProbeOutput` / `NativeLoaderError` | — (TS loader only, C1) | FR19, C1, C2 |
| `#Platform` / `#DiscoverySource` / `#NativeToolBackend` / `#GapReason` (`enums-telemetry.cue`) | `Platform` / `NativeBackend` / `NativeUnavailableGapReason` | — (TS wrapper only, C14) | FR18, FR24, C14, C19 |
| `#NativeTelemetryLabels` / `#PtyLifecycleLabels` (`config.cue`) | `NativeToolInvokeMeta` | — (TS telemetry only, ADR-0001) | FR24, C14 |
| `#GrepOutputMode` (`enums.cue`) | `GrepOutputMode` | `GrepOutputMode` in `opencode-tools-ffi` | FR6, AC7 |

---

## Notes on authority and reuse

- No shape here is a store of record: ToolRegistry, Feature 007 PermissionV2, Feature 005
  OutputSpool, and Feature 001 / ADR-0001 telemetry remain the sources of truth; the FFI wire
  carries only transient value objects (FR13, FR23, FR24, C20).
- The one identity-bearing shape, `#PtySessionEntry`, lives in the TypeScript registry, never
  in native code; native code holds no lifecycle state across calls (C10, C20).
- Read caps (`#AbiCaps`) and PTY grace/capture constants mirror the `read-filesystem.ts` and
  `bash.ts` sources of truth and are test-locked so the Rust duplication never drifts (C16,
  C20).
- The `native_unavailable` gap and backend-selection telemetry reuse the content-free
  bounded-label helpers and the single exporter — no new exporter, SDK, or pipeline (FR24,
  C14).
- `@lydell/node-pty` is untouched; the native PTY path uses `portable-pty` + `libc` and Bun's
  `node:net.Socket({ fd })`, with no shared owner of the master fd (C9).
