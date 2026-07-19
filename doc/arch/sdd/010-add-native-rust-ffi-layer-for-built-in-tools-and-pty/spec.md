---
id: 019f7837-4e0a-7d43-a299-aa451348a906
number: 010
slug: add-native-rust-ffi-layer-for-built-in-tools-and-pty
status: specified
created_at: 2026-07-19T02:31:58.218719Z
---
# Feature Specification: Native Rust FFI Tools and PTY Integration

Feature: 010-add-native-rust-ffi-layer-for-built-in-tools-and-pty
Created: 2026-07-19
Scope: Add two Rust `cdylib` libraries, loaded through Bun's `bun:ffi` `dlopen`, that
(a) reimplement six filesystem/text built-in tools with behavioral parity to their
TypeScript references and (b) add real PTY-backed terminal integration for the shell
tool. Native code is a **performance/fidelity substitute** behind a lazy-loaded seam:
when the compiled library is absent or fails to load, every affected surface falls back
silently to the existing TypeScript implementation with no behavioral change. The
permission/approval gate, telemetry conventions, and tool output identity remain owned
by their current features and MUST NOT move into native code.

## Scope and intent

OpenCode is a TypeScript AI coding agent that runs exclusively on Bun. Its twelve
built-in tools live in `packages/core/src/tool/` and are composed in
`packages/core/src/tool/builtins.ts`: `apply_patch`, `bash`, `edit`, `glob`, `grep`,
`question`, `read`, `skill`, `todowrite`, `webfetch`, `websearch`, and `write`. Bun
already exposes FFI through the `bun:ffi` module (`dlopen`), and the codebase already
uses it in two production sites — `packages/tui/src/terminal-win32.ts` (kernel32 console
mode) and `packages/opencode/src/operator/adapters/outbound/keychain-darwin.ts` (Darwin
Security.framework). This feature is the first Rust code in the repository: no
`Cargo.toml` and no cargo workspace exist today.

Feature 010 introduces two crates:

- **`opencode-tools-ffi`** (`cdylib`) — native reimplementation of the six
  filesystem/text tools: `read`, `write`, `edit`, `apply_patch`, `glob`, and `grep`.
  These six are exactly the built-ins whose behavior is pure filesystem/text processing.
  The remaining six built-ins are out of scope: `bash` is not reimplemented (it gains
  PTY mode only), and `question`, `todowrite`, `skill`, `webfetch`, and `websearch`
  are not filesystem/text tools.
- **`opencode-pty-ffi`** (`cdylib`) — PTY-based terminal integration. Today the shell
  tool (`packages/core/src/tool/bash.ts`) spawns through `ChildProcess.make` +
  `AppProcess.run` with `detached` process groups and a combined-output byte cap; it
  allocates no controlling TTY, so spawned commands see `isatty() == false`. This crate
  allocates a real PTY and spawns a session with a controlling terminal, exposing spawn,
  resize, kill, wait, and close entry points.

Native code is authoritative for **nothing**. Tool identity, registration, and
permission visibility remain owned by ToolRegistry and PermissionV2; tool output
identity remains owned by Feature 005 OutputSpool; telemetry conventions remain owned by
Feature 001 / ADR-0001. The FFI layer is a swappable execution backend behind each
tool's existing TypeScript boundary.

### Ownership split (no duplication)

| Concern                                                        | Owner                          |
| ------------------------------------------------------------- | ------------------------------ |
| Tool identity, registration, model-facing schema              | ToolRegistry (unchanged)       |
| Permission/approval gate evaluated before every tool action   | Feature 007 PermissionV2       |
| Tool/process output plane (OutputRef, paged read, seal)       | Feature 005 OutputSpool        |
| Telemetry span/metric conventions, bounded labels             | Feature 001 / ADR-0001         |
| Native filesystem/text execution for six tools                | **Feature 010 (opencode-tools-ffi)** |
| PTY allocation, spawn, resize, kill, wait, close              | **Feature 010 (opencode-pty-ffi)**   |
| Shell command semantics, approval, external-directory scan    | `bash.ts` (TypeScript, unchanged authority) |
| Async IO on the PTY master fd                                 | Bun event loop (TypeScript)    |

## Actors

- **Agent / model** — invokes the built-in tools by their existing model-facing names and
  schemas; observes no interface change whether execution is native or TypeScript.
- **Tool runtime (TypeScript)** — owns each tool's boundary, evaluates the permission
  gate, selects the native backend when available, and marshals JSON across the FFI seam.
- **Native tools library (`opencode-tools-ffi`)** — executes the six filesystem/text
  operations and returns JSON results.
- **Native PTY library (`opencode-pty-ffi`)** — allocates the PTY, spawns the child under
  a controlling TTY, and manages its lifecycle by process group.
- **Operator / maintainer** — builds the release libraries, controls whether the native
  backend is enabled, and reads the parity/stress evidence.
- **Security reviewer** — verifies the permission gate never moves into native code and
  that fallback never changes observable behavior.

## In scope

- Two `cdylib` crates plus a first-time cargo workspace at the repository root.
- Native parity implementations of `read`, `write`, `edit`, `apply_patch`, `glob`, `grep`.
- PTY spawn/resize/kill/wait/close entry points with a single-owner fd contract.
- An opt-in `pty: true` mode on `bash.ts` with the permission gate still in TypeScript.
- A synchronous JSON FFI contract with `catch_unwind` on every entry point and an
  exported `oc_free`.
- TypeScript wrappers mirroring the current tool interfaces and a parity test suite that
  runs each tool against both implementations on shared fixtures.
- A `cargo build --release` pipeline producing `.dylib`/`.so`, loaded lazily via `dlopen`
  with graceful fallback to TypeScript when the library is missing.
- macOS and Linux platform support.

## Out of scope

- Reimplementing `bash` shell semantics in Rust — the shell tool keeps its TypeScript
  command/approval logic and only gains an opt-in PTY spawn backend.
- The six non-filesystem/text built-ins: `question`, `todowrite`, `skill`, `webfetch`,
  `websearch` (and `bash` reimplementation).
- Windows ConPTY support — phase 2.
- Any Tokio/async runtime inside the FFI boundary in phase 1; the phase 2 multi-session
  PTY manager (and an optional `mio` reader thread) MUST NOT change the FFI contract.
- Moving the permission/approval gate, telemetry, or tool-output identity into native
  code.
- A second tool registry, a second output plane, or a second event system.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Native execution with identical behavior

- As an agent, I want `read`, `write`, `edit`, `apply_patch`, `glob`, and `grep` to
  produce byte-identical results whether they run through the native library or the
  TypeScript reference, so tool behavior never depends on which backend is loaded.
- As a maintainer, I want each native tool covered by a parity suite that runs both
  implementations on shared fixtures, so any divergence fails the build.

### P1 — Real terminal for interactive commands

- As an agent running an interactive or color-aware command, I want the shell tool's
  opt-in PTY mode to give the child a controlling TTY so `isatty()` is true and ANSI
  output is emitted, without the agent event loop blocking on long-running sessions.
- As a user, I want a PTY-spawned command's full process tree terminated on kill, so no
  orphaned children survive a cancelled session.

### P1 — Never a hard dependency

- As an operator, I want every native tool to fall back silently to its TypeScript
  implementation when the compiled library is absent or fails to load, so a missing
  `.dylib`/`.so` degrades to today's behavior with no observable change.
- As a security reviewer, I want the permission/approval gate evaluated in TypeScript
  before any native call, so native code never becomes a permission authority.

### P1 — Safe FFI boundary

- As a maintainer, I want every FFI entry point wrapped in `catch_unwind`, returning a
  typed JSON error rather than unwinding across the boundary, and every Rust-allocated
  response freed exactly once via `oc_free`, so the boundary is panic-safe and leak-free.

### P2 — Observable and content-free

- As an operator, I want native vs TypeScript backend selection and the typed
  `native_unavailable` capability gap surfaced through content-free telemetry consistent
  with ADR-0001, so I can see which backend served a call without leaking content.

### P3 — Incremental delivery

- As a maintainer, I want the work delivered in order (PoC `read` + `grep`, then the
  remaining filesystem tools, then the PTY crate, then `bash.ts` integration, then the
  parity/stress suite) so each stage is independently verifiable.

## Functional Requirements

### Native tools crate (`opencode-tools-ffi`)

1. The crate MUST implement `read` with behavioral parity to
   `packages/core/src/tool/read-filesystem.ts`: 1-based line offset and limit windowing,
   the 2000-line page cap (`MAX_READ_LINES`), the 50 KiB page byte cap
   (`MAX_READ_BYTES`), the 2000-character line cap with the
   `... (line truncated to 2000 chars)` suffix, the paged-vs-whole decision (paged when
   size exceeds `MAX_READ_BYTES` or an offset/limit is supplied), the `next` continuation
   cursor and `truncated` flag, binary detection (NUL byte, non-printable ratio above
   0.3, the known binary extension set, and PDF/image magic bytes), the UTF-8 fatal-decode
   contract, and the out-of-range-offset error.
2. The crate MUST implement `write` with create/overwrite semantics and MUST perform an
   atomic write (write to a temporary file in the destination directory, then rename over
   the target) so a partial write never leaves a truncated destination.
3. The crate MUST implement `edit` as exact string replacement with uniqueness
   validation: it MUST error when the target string is absent, and MUST error on ambiguity
   (more than one occurrence) unless replace-all mode is requested; replace-all MUST
   substitute every exact occurrence. The replacement string MUST differ from the target.
4. The crate MUST implement `apply_patch` with multi-hunk parsing and application,
   matching each hunk against surrounding context and failing with a typed error when
   context does not match, at parity with the TypeScript `apply_patch` reference.
5. The crate MUST implement `glob` as file-pattern search that honors `.gitignore`, with
   results sorted by modification time, using the Rust `ignore` and `globset` crates.
6. The crate MUST implement `grep` with an embedded ripgrep engine (`grep-searcher`,
   `grep-regex`, `ignore`) and MUST NOT spawn an external `rg` process. It MUST support
   the output modes files-with-matches, content with line numbers and context, and count.
   This replaces the current external-binary spawn path
   (`packages/core/src/ripgrep.ts` spawns the `rg` binary via `ChildProcess`).
7. The six native tools MUST produce output that is structurally and byte-identical to
   the TypeScript references on shared fixtures, ignoring only ordering ties that the
   references themselves do not define.

### PTY crate (`opencode-pty-ffi`)

8. The crate MUST expose `oc_pty_spawn`, which allocates a PTY and spawns a child through
   `portable-pty` with `setsid` and a controlling TTY, returning `{ session_id, pid,
   master_fd }`. The child MUST observe `isatty() == true` on its standard streams.
9. The crate MUST expose `oc_pty_resize` (window size via `TIOCSWINSZ`), `oc_pty_kill`
   (deliver a signal to the child's process group so the full process tree is affected),
   `oc_pty_wait` (non-blocking `waitpid` with `WNOHANG`), and `oc_pty_close` (full
   teardown honoring a single-owner file-descriptor contract, so the master fd is closed
   exactly once by its owner).
10. Asynchronous IO MUST stay on the Bun side: TypeScript reads and writes the
    `master_fd` directly through Bun's event loop (kqueue/epoll). There MUST be no FFI
    call on the IO hot path, and a long-running PTY session MUST stream while the agent
    stays responsive.
11. The PTY crate MUST NOT include a Tokio or other async runtime in phase 1; the FFI
    boundary is synchronous. A future phase-2 multi-session manager or `mio` reader thread
    MUST NOT change the FFI contract defined here.

### Shell tool integration

12. `bash.ts` MUST gain an opt-in `pty: true` mode that routes the spawn through
    `opencode-pty-ffi`; the default (`pty` unset or false) MUST keep the current
    `ChildProcess`/`AppProcess` behavior unchanged.
13. The permission/approval gate MUST remain in TypeScript and MUST be evaluated before
    any PTY allocation or spawn, exactly as `bash.ts` calls `permission.assert` today.
    Native code MUST NOT evaluate, cache, or bypass permissions.

### FFI contract (cross-cutting)

14. Every native entry point MUST use the signature `extern "C" fn oc_<name>(req_ptr:
    *const u8, req_len: usize) -> *mut c_char`, taking a JSON request buffer and returning
    a JSON response C string, serialized with `serde`.
15. Errors MUST be returned as structured JSON `{ ok: false, error: { code, message } }`,
    never as numeric return codes. Success responses MUST carry `{ ok: true, ... }`.
16. Every entry point MUST wrap its body in `catch_unwind` so a Rust panic is converted to
    a typed JSON error and NEVER unwinds across the FFI boundary.
17. Every Rust-allocated response pointer MUST be freed exactly once, only through the
    exported `oc_free`; the TypeScript wrapper MUST call `oc_free` after copying each
    response. No response may be freed on the Rust side after return, and none may leak.

### TypeScript integration and fallback

18. Each of the six tools MUST have a TypeScript wrapper that mirrors the current tool
    interface (input schema, output schema, and model-facing output) so the native backend
    is transparent to callers and to the model.
19. The native libraries MUST be loaded lazily via `dlopen` on first use. When a library
    is missing or fails to load, the wrapper MUST fall back to the existing TypeScript
    implementation and MUST record a typed `native_unavailable` capability gap, mirroring
    the repository's typed capability-gap posture (the `milvus_unavailable` precedent from
    the semantic stack). Fallback MUST be silent and behavior-identical.
20. The parity test suite MUST run each of the six tools against both the native and the
    TypeScript implementation on shared fixtures and MUST assert identical results; the
    suite MUST also cover a memory-leak stress test that verifies every `oc_*` response is
    freed via `oc_free`.

### Build pipeline

21. A cargo workspace MUST build both crates with `cargo build --release`, producing
    `.dylib` (macOS) and `.so` (Linux) artifacts that the TypeScript layer discovers and
    loads via `dlopen`. Absence of the artifact MUST NOT break the build or the runtime;
    it MUST trigger the FR19 fallback.
22. Platform support MUST cover macOS and Linux first. Windows ConPTY is phase 2 and out
    of scope for this feature; the FFI contract MUST remain unchanged when it is added.

### Cross-feature seams (record, do not expand)

23. Native and TypeScript tool outputs MAY flow to the Feature 005 OutputSpool through the
    tools' existing output path; Feature 010 MUST NOT introduce a second output plane and
    MUST NOT re-specify OutputSpool behavior.
24. Telemetry for backend selection and the `native_unavailable` gap MUST be content-free
    and follow ADR-0001 bounded-label conventions: no file contents, paths, patch bodies,
    command strings, or session ids as metric labels.

## Non-Functional Requirements

1. Native tool results MUST be deterministic and byte-identical to the TypeScript
   references on shared fixtures, ignoring only undefined ordering ties.
2. The FFI boundary MUST be panic-safe: no Rust panic may cross into Bun; every entry
   point is `catch_unwind`-wrapped (FR16).
3. The boundary MUST be leak-free under stress: every response is freed exactly once via
   `oc_free`, verified by a stress test (FR17, FR20).
4. The agent event loop MUST NOT block on PTY IO; reads and writes on the master fd stay
   on Bun's event loop with no FFI call on the hot path (FR10).
5. `oc_pty_kill` MUST terminate the full child process tree via the process group, leaving
   no orphaned children (FR9).
6. With the native library absent, every affected tool MUST operate through TypeScript
   with no behavioral change and no hard failure (FR19).

## Acceptance Scenarios

1. **Six-tool parity.** Given the shared fixtures, when each of `read`, `write`, `edit`,
   `apply_patch`, `glob`, and `grep` runs through both the native library and the
   TypeScript reference, then every result is byte-identical, ignoring undefined ordering
   ties.
2. **Read windowing parity.** Given a file larger than 50 KiB and an offset/limit, when
   native `read` pages it, then line numbering, the 2000-line/50 KiB caps, the 2000-char
   line truncation suffix, the `truncated` flag, and the `next` cursor match
   `read-filesystem.ts` exactly.
3. **Atomic write.** Given a write that is interrupted before completion, when the
   destination is inspected, then it is either the full new content or the unchanged prior
   content, never a truncated partial file.
4. **Edit uniqueness.** Given a target string that occurs zero times, exactly once, or
   more than once, when native `edit` runs without replace-all, then it errors on zero and
   on more-than-one and succeeds on exactly one; with replace-all it substitutes every
   occurrence.
5. **Multi-hunk patch.** Given a multi-hunk patch whose context matches, when native
   `apply_patch` runs, then all hunks apply at parity with the reference; given a hunk
   whose context does not match, then it fails with a typed error and applies nothing.
6. **Glob honors gitignore and mtime.** Given a repository with `.gitignore` entries, when
   native `glob` runs on the opencode repository itself, then ignored paths are excluded
   and results are ordered by modification time, identical to the reference ignoring
   ordering ties.
7. **Grep embedded engine parity.** Given the opencode repository as the corpus, when
   native `grep` runs in files-with-matches, content-with-context, and count modes, then
   results are identical to the reference and no external `rg` process is spawned.
8. **PTY is a real terminal.** Given a command spawned via `oc_pty_spawn`, when it queries
   its stdio, then `isatty()` is true and ANSI color output is emitted.
9. **Full-tree kill.** Given a PTY session whose child forks a subprocess tree, when
   `oc_pty_kill` signals the process group, then the entire tree is terminated with no
   orphaned children.
10. **Non-blocking event loop.** Given a long-running PTY session streaming output, when
    the agent continues working, then the event loop never blocks and output streams via
    the Bun-side master-fd reader with no FFI call on the hot path.
11. **No boundary leak.** Given a stress run issuing many `oc_*` calls, when each response
    is freed via `oc_free`, then no memory is leaked across the boundary.
12. **Panic contained.** Given a native entry point that panics internally, when it is
    invoked, then `catch_unwind` returns `{ ok: false, error: { code, message } }` and the
    Bun process does not crash.
13. **Library absent — silent fallback.** Given the compiled `.dylib`/`.so` is missing,
    when any of the six tools runs, then it executes through the TypeScript implementation
    with byte-identical behavior and records a typed `native_unavailable` capability gap.
14. **Load failure — graceful degrade.** Given a present but unloadable library, when
    `dlopen` fails, then the wrapper degrades to TypeScript without a hard failure.
15. **Permission gate stays in TypeScript.** Given a `bash` invocation with `pty: true`,
    when the tool runs, then `permission.assert` is evaluated in TypeScript before any PTY
    allocation, and no permission decision occurs in native code.
16. **Default bash unchanged.** Given `pty` unset or false, when `bash` runs, then it uses
    the current `ChildProcess`/`AppProcess` path with no change to timeout, capture cap, or
    output semantics.
17. **Content-free telemetry.** Given native/TypeScript backend selection and the
    `native_unavailable` gap, when telemetry is exported, then no file contents, paths,
    patch bodies, command strings, or session ids appear as labels.
18. **Release build produces loadable artifacts.** Given `cargo build --release`, when it
    completes on macOS and Linux, then it produces `.dylib`/`.so` artifacts that the
    TypeScript layer loads via `dlopen`, and their absence triggers fallback rather than a
    build or runtime failure.

## Security Requirements

- **Data sensitivity/classification.** The native tools read and write project files and
  patch/edit content — the same data the TypeScript tools already handle. Native code
  introduces no new persistence and no new exposure surface; it processes the same bytes
  behind the same tool boundary.
- **Authentication/authorization.** The feature introduces no new authenticated surface.
  The permission/approval gate stays in TypeScript (Feature 007 PermissionV2) and is
  evaluated before every native call and before any PTY spawn (FR13). Native code MUST
  NEVER evaluate, cache, or bypass permissions.
- **Input validation.** Every FFI entry point parses a JSON request with `serde` and MUST
  reject malformed or oversized input with a typed JSON error rather than panicking; the
  `catch_unwind` wrapper is the backstop so hostile or malformed content cannot unwind
  across the boundary (FR14–FR16). Patch, glob, and regex inputs are bounded by the same
  caps the TypeScript references enforce.
- **Cryptography in transit/at rest.** Not applicable — the feature moves no data over a
  network and persists no new secret material; it performs local filesystem and PTY
  operations only.
- **Logging/audit.** Telemetry is content-free (FR24): backend selection and the
  `native_unavailable` gap are recorded with bounded labels only, never file contents,
  paths, patch bodies, command strings, or session ids.
- **Error-handling information exposure.** FFI errors are stable typed
  `{ code, message }` payloads (FR15) and MUST NOT leak internal pointers, absolute host
  paths beyond what the tool already returns, or memory addresses. A panic is converted to
  a generic typed error, not a raw backtrace across the boundary.

## Observability

Integrate with ADR-0001 and Feature 001 conventions. The tool layer MUST emit
content-free signals for backend selection (native vs TypeScript) and for the typed
`native_unavailable` capability gap, with bounded labels only (tool name, backend, gap
reason as stable enums). No file contents, paths, patch bodies, command strings, vectors,
or session ids may appear as labels. PTY session lifecycle (spawn/kill/close counts) MAY
be surfaced as bounded counters. Feature 005 OutputSpool remains the plane for large
tool/process output as refs; Feature 010 emits no raw output as telemetry.

## Compatibility and Migration

- The six tools keep their model-facing names, input schemas, and output schemas; the
  native backend is transparent (FR18). No migration is required for callers or the model.
- With the native library absent or unloadable, every tool runs through the existing
  TypeScript implementation with byte-identical behavior (FR19). Enabling native execution
  is additive.
- `bash.ts` default behavior is unchanged; PTY is opt-in via `pty: true` (FR12, FR16).
- `grep`/`glob` move from spawning the external `rg` binary to the embedded ripgrep engine
  only when the native library is loaded; the TypeScript path (external `rg`) remains the
  fallback (FR6, FR19).
- The cargo workspace is the first Rust in the repository; its absence at build time does
  not break the TypeScript build or runtime (FR21).
- Windows support is deferred to phase 2 (ConPTY) without changing the FFI contract
  (FR22).

## Clarification Questions

1. Where do the compiled `.dylib`/`.so` artifacts live and how does the TypeScript layer
   discover them (bundled path, env override, per-platform naming)?
2. Is native execution on by default when the library is present, or opt-in behind a
   Config.Service flag per tool?
3. Exact JSON request/response schema per tool (field names, error `code` enum values)?
4. Does `grep`/`glob` retain the current `Ripgrep` service seam as the fallback, or is the
   fallback the pre-existing TypeScript tool path directly?
5. How is the `master_fd` ownership transferred to Bun (raw fd number, dup semantics) and
   who guarantees the single-owner close contract across the FFI boundary?
6. Which signal does `oc_pty_kill` deliver by default (SIGTERM vs SIGKILL) and is there a
   grace period before escalation, mirroring `bash.ts` `forceKillAfter`?
7. What is the parity-suite corpus and how are undefined ordering ties normalized for the
   byte-identical assertion?
8. Does the `native_unavailable` capability gap surface to the operator control plane, or
   is it telemetry-only?
9. Minimum supported Rust toolchain and how it is pinned/enforced in CI.
10. Are `read`/`write` size caps (`MAX_READ_BYTES`, `MAX_MEDIA_INGEST_BYTES`) shared
    constants across the FFI boundary or duplicated per side?

## Related Features and Decisions

- [Feature 001 Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — content-free telemetry and bounded-label conventions reused for backend-selection signals
- [Feature 005 OutputSpool and ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) — the output plane that native and TypeScript tool outputs flow to as refs; not re-specified here
- [Feature 006 Milvus Semantic Retrieval](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — the `milvus_unavailable` typed capability-gap precedent that the `native_unavailable` fallback mirrors
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — PermissionV2 authority; the permission gate that stays in TypeScript
- [ADR-0001 OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md) — no content or paths as metric labels
- [ADR-0010 Native Rust FFI Layer for Built-in Tools and PTY](../../adr/0010-add-native-rust-ffi-layer-for-built-in-tools-and-pty.md) — this feature's decision record

## Initial Traceability Matrix

| Outcome                                | Requirements | Acceptance scenarios | Phase |
| -------------------------------------- | ------------ | -------------------- | ----- |
| Native filesystem/text tool parity     | FR1–FR7      | 1–7                  | 1     |
| PTY spawn/lifecycle and terminal fidelity | FR8–FR11  | 8–10                 | 1     |
| Shell opt-in PTY with TS permission gate | FR12–FR13  | 15–16                | 1     |
| Panic-safe, leak-free JSON FFI contract | FR14–FR17   | 11–12                | 1     |
| Transparent wrappers and silent fallback | FR18–FR20  | 13–14                | 1     |
| Release build and platform support     | FR21–FR22    | 18                   | 1     |
| Output-plane and content-free telemetry seams | FR23–FR24 | 17               | 1     |
