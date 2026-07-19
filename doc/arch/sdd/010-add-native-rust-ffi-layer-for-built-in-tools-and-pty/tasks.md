# Tasks: Native Rust FFI Tools and PTY Integration (Feature 010)

Ordered, measurable work breakdown derived from `plan.md` slices S0–S16, the
`data-model.md` entities (13-value error taxonomy, 84 CUE defs), `contracts/ports.ts`,
ADR-0010, and the `doc/arch/schemas/ffi/*.cue` corpus (15 files across the
`ffi.enums`/`ffi.shared`/`ffi.envelope`/`ffi.tools`/`ffi.pty`/`ffi.config` packages). Every
task stays inside the `specScopeGlobs` declared in `doc/arch/speckit.toml`. This feature
adds the **first Rust in the repository** — two `cdylib` crates and one shared `rlib` — and
is authoritative for **nothing**: tool identity/registration stays with ToolRegistry, the
permission/approval gate stays in TypeScript (Feature 007 PermissionV2) evaluated **before**
every native call and every PTY spawn, tool-output identity stays with Feature 005
OutputSpool, and telemetry stays content-free (ADR-0001). When the compiled library is
absent, unloadable, ABI-mismatched, or the Config flag is off, every affected surface falls
back **silently and behavior-identically** to the current TypeScript path and records a
typed `native_unavailable` capability gap mirroring the Feature 006 `milvus_unavailable`
precedent.

The FFI boundary is **synchronous, panic-safe, and leak-free by contract**: every entry
point is `catch_unwind`-wrapped and returns the CUE-normative `#FfiResponse` envelope
(`{ status: "ok", result }` / `{ status: "error", error: { code, message } }`, `ok` read as
`status == "ok"`); every Rust-allocated response is freed exactly once through the exported
`oc_free`. PTY async IO stays entirely on Bun's event loop: `oc_pty_spawn` hands the master
fd to Bun as the sole owner, and Bun reads/writes it via `node:net.Socket({ fd })` with
`O_NONBLOCK` — no FFI call on the IO hot path. No Tokio or async runtime is introduced in
phase 1.

Delivery follows the spec's implementation order across five phases: **Phase 1** workspace
bootstrap + the `opencode-ffi-abi` rlib (the panic-safe/leak-free boundary implemented
once); **Phase 2** the PoC — `oc_read` + `oc_grep`, the `loader.ts` discovery/dlopen/gap
seam, the two TS wrappers, and the shared-fixtures parity harness proving byte-identity on
two tools end to end; **Phase 3** the remaining filesystem tools (`write`, `edit`,
`apply_patch`, `glob`); **Phase 4** the `opencode-pty-ffi` crate + the Bun-side registry/
reader + `bash.ts` `pty: true`; **Phase 5** the leak/panic stress suite, the fallback
byte-identity suite, content-free telemetry, the `build:native` pipeline, and close-out.

Rust tasks are accepted with `cargo build --release`, `cargo test`, and
`cargo clippy`; TypeScript tasks with `bun run typecheck` (`tsgo --noEmit`) and `bun test`.
Platform gates are `darwin`/`linux` only; `win32` always takes the TypeScript fallback and
never `dlopen`s. Provisional plan constants (bundled subpath layout, `build:native` copy
layout, stress iteration count, RSS ceiling, pinned toolchain channel) carry named
acceptance hooks (AC11, AC13, AC14, AC18) and are finalized here; crate versions and FFI
symbols are pinned by `plan.md`, not provisional.

## Task Breakdown

### Workspace bootstrap and shared ABI crate (Phase 1)

- [ ] T001 [S0] Bootstrap the cargo workspace at the repository root: author `Cargo.toml`
  (workspace `members = ["crates/opencode-ffi-abi", "crates/opencode-tools-ffi",
  "crates/opencode-pty-ffi"]` plus a single-sourcing `[workspace.dependencies]` pinning the
  exact versions from `plan.md` — `serde =1.0.229` `features = ["derive"]`,
  `serde_json =1.0.150`, `ignore =0.4.30`, `globset =0.4.19`, `grep-searcher =0.1.17`,
  `grep-regex =0.1.14`, `grep-matcher =0.1.9`, `portable-pty =0.9.0`, `libc =0.2.186`),
  `rust-toolchain.toml` (`channel = "1.83.0"`, `profile = "minimal"`, components
  `rustfmt`+`clippy`, `edition` via crate manifests at `2021`), the committed `Cargo.lock`
  (reproducible, pin-locked), and extend `.gitignore` with `/target` and
  `packages/core/native/*/` so built dylibs and the bundled landing dir are never committed
  (FR21, C6, C15). Acceptance: `cargo metadata` resolves every dependency to the pinned
  `=x.y.z`, `.gitignore` excludes `/target` and `packages/core/native/*/`, and `Cargo.lock`
  is present and committed.
- [ ] T002 [S1] Author `crates/opencode-ffi-abi/Cargo.toml` (rlib, not shipped) and the
  envelope core of `crates/opencode-ffi-abi/src/lib.rs`: the `#FfiResponse` serde types
  mirroring `doc/arch/schemas/ffi/envelope.cue` one-to-one (`{ status: "ok", result }` /
  `{ status: "error", error: { code, message } }`), the closed 13-value `error.code` enum
  mirroring `ffi.enums` (`invalid_request`, `not_found`, `not_a_file`, `binary_file`,
  `malformed_utf8`, `offset_out_of_range`, `media_limit`, `ambiguous_match`, `no_match`,
  `context_mismatch`, `invalid_pattern`, `io_error`, `internal_panic`), the `catch_unwind`
  wrapper that converts any unwind to `{ status: "error", error: { code: "internal_panic",
  message: <generic> } }` with no backtrace/pointer/address crossing the boundary, the sole
  `oc_free(ptr: *mut c_char)` dealloc path, and the atomic alloc/free counter incremented on
  every response allocation and decremented in `oc_free` (FR14, FR15, FR16, FR17, C3, C6, C7,
  C18). Acceptance: `cargo build -p opencode-ffi-abi`, `cargo clippy -p opencode-ffi-abi`
  (no warnings), and `cargo test -p opencode-ffi-abi` assert a panicking body yields the
  `internal_panic` envelope, a success/error envelope serializes to the CUE shape, and the
  alloc counter returns to its at-rest value after `oc_free`.
- [ ] T003 [S1] Complete the `opencode-ffi-abi` handshake and parity surface in
  `crates/opencode-ffi-abi/src/lib.rs`: `oc_abi_version() -> u32` (the ABI-major the loader
  asserts), `oc_version() -> *mut c_char` (semver JSON plus the C16 introspected capability
  constants), and the debug-gated `oc_alloc_stats() -> *mut c_char` (`{ allocated, freed }`
  for C18); and mirror the parity constants as Rust `const` test-locked to their TypeScript
  anchors — `MAX_READ_LINES=2000`, `MAX_READ_BYTES=51200`, `MAX_MEDIA_INGEST_BYTES=20971520`,
  `MAX_LINE_LENGTH=2000`, the `... (line truncated to 2000 chars)` suffix, the binary-detection
  set, `MAX_CAPTURE_BYTES=1048576`, `forceKillAfter=3s` — surfaced through `oc_version`
  introspection so the TS-vs-Rust parity test (T008) can assert no drift (FR14, C7, C16, C18).
  Acceptance: `cargo test -p opencode-ffi-abi` asserts `oc_abi_version` is stable,
  `oc_version` emits the semver + introspected caps JSON, and `oc_alloc_stats` reports matched
  `allocated`/`freed` at rest under the debug feature.

### PoC — `read` + `grep` native, loader, wrapper seam, parity harness (Phase 2)

- [ ] T004 [S2] Author `crates/opencode-tools-ffi/Cargo.toml` (cdylib, inheriting the abi
  rlib and workspace deps) and `crates/opencode-tools-ffi/src/lib.rs` + `src/read.rs` with
  `oc_read`: 1-based offset/limit windowing, the `MAX_READ_LINES`/`MAX_READ_BYTES` page caps,
  the 2000-char line cap with the `... (line truncated to 2000 chars)` suffix, the
  paged-vs-whole decision (paged when size exceeds `MAX_READ_BYTES` or an offset/limit is
  supplied), the `next` continuation cursor and `truncated` flag, binary detection (NUL byte,
  non-printable ratio `> 0.3`, the known-extension set, PDF/PNG/JPEG/GIF/WEBP magic), the
  UTF-8 fatal-decode contract (`malformed_utf8`), and the `offset_out_of_range` error — all
  at byte-identical parity with `packages/core/src/tool/read-filesystem.ts` and every entry
  point `catch_unwind`-wrapped (FR1, C7, C16, AC2). Acceptance: `cargo build --release
  -p opencode-tools-ffi`, `cargo clippy` clean, and `cargo test -p opencode-tools-ffi` assert
  the windowing/caps/truncation/binary/UTF-8/offset paths against the mirrored constants.
- [ ] T005 [S3] Author `crates/opencode-tools-ffi/src/grep.rs` and wire `oc_grep` into
  `lib.rs` using the embedded `grep-searcher`/`grep-regex`/`grep-matcher`/`ignore` engine —
  **no external `rg` spawn** — supporting the files-with-matches, content-with-line-numbers-
  and-context, and count output modes at parity with `packages/core/src/ripgrep.ts` output
  shapes, returning `invalid_pattern` on a bad regex (FR6, C4, C5, AC7). Acceptance:
  `cargo build --release -p opencode-tools-ffi`, `cargo clippy` clean, and
  `cargo test -p opencode-tools-ffi` assert each output mode, `.gitignore`-aware walking, and
  the `invalid_pattern` code, with no subprocess spawn in the code path.
- [ ] T006 [S4] Author `packages/core/src/tool/native/loader.ts`: the discovery ladder
  (env override `OPENCODE_NATIVE_LIB_DIR` / per-crate `OPENCODE_TOOLS_FFI_PATH` /
  `OPENCODE_PTY_FFI_PATH` → bundled `packages/core/native/<platform>-<arch>/` → typed
  `native_unavailable`), lazy `dlopen` (cached after first success) reusing the `bun:ffi`
  `dlopen` + `read.ptr`/`CString` pattern from `packages/tui/src/terminal-win32.ts` and
  `packages/opencode/src/operator/adapters/outbound/keychain-darwin.ts`, the `oc_abi_version`
  ABI-major handshake assert, the `oc_free`-after-copy marshalling helper (copy the C string,
  then free exactly once), and the platform gate — `darwin`/`linux` only, `win32` never
  `dlopen`s and always returns `native_unavailable` — with the bounded gap reason
  (`library_missing`/`dlopen_failed`/`abi_mismatch`/`disabled`) (FR18, FR19, C1, C7, C8, C14,
  C19, AC13, AC14). Acceptance: `bun run typecheck` on `packages/core` green and
  `bun test packages/core/test/tool/native` asserts each discovery rung, a cached second load,
  the ABI-mismatch gap, and `win32` never attempting `dlopen`.
- [ ] T007 [S5] Author `packages/core/src/tool/native/read.native.ts` and
  `grep.native.ts` mirroring each tool's input schema, output schema, and `toModelOutput` so
  the native backend is transparent to the model; add the per-call native-vs-TS selection
  gated by `experimental.nativeTools` (the boolean introduced here in
  `packages/core/src/config/experimental.ts`, default `false`; finalized behaviorally by
  T017), the error-code → `ToolFailure` translation re-emitting the identical TS message so
  native and fallback are indistinguishable, and route `grep` (and, later, `glob`) selection
  through `packages/core/src/tool/grep.ts` so the `Ripgrep.Service` external-`rg` spawn stays
  the fallback seam (FR5, FR6, FR18, C2, C4, C5, C8, AC1). Acceptance: `bun run typecheck` on
  `packages/core` green and `bun test packages/core/test/tool/native` asserts the wrappers
  preserve the tool interface, select native only when the flag is on, translate every
  `error.code` to the exact TS `ToolFailure`, and fall back through the Ripgrep seam.
- [ ] T008 [S6] Author the shared fixtures `packages/core/test/fixtures/native-parity/`
  (binary, CRLF/LF, `>50 KiB` paged, 2000-char lines, non-ASCII UTF-8) and the parity harness
  under `packages/core/test/tool/native/` running `read` and `grep` through **both** backends
  and asserting byte-identity, with repo-level `grep` equivalence over the opencode repo
  ignoring the undefined `(path, line, offset)` tie order, plus the TS-vs-Rust constant-parity
  assertion against `oc_version` introspection (T003) and the read+grep fallback byte-identity
  when the dylib is absent (FR1, FR7, FR20, NFR1, NFR6, C13, C16, AC1, AC2, AC7). Acceptance:
  `bun test packages/core/test/tool/native` green with `read`/`grep` byte-identical across
  backends, the repo-level `grep` corpus matching after tie normalization, no external `rg`
  spawn on the native path, and the mirrored constants equal to their TS anchors.

### Remaining filesystem tools (Phase 3)

- [ ] T009 [S7] Author `crates/opencode-tools-ffi/src/write.rs` (`oc_write`) with
  create/overwrite semantics and an **atomic** write — temp file in the destination directory
  then rename over the target so a partial write never leaves a truncated destination — and
  `packages/core/src/tool/native/write.native.ts` mirroring `packages/core/src/tool/write.ts`;
  extend the parity suite with an interrupted-write fixture (FR2, FR18, AC3). Acceptance:
  `cargo test -p opencode-tools-ffi` and `bun test packages/core/test/tool/native` assert the
  destination is always full-new or unchanged-prior (never truncated) and the wrapper is
  byte-identical to the TS reference.
- [ ] T010 [S8] Author `crates/opencode-tools-ffi/src/edit.rs` (`oc_edit`) as exact string
  replacement with uniqueness: `no_match` on zero occurrences, `ambiguous_match` on more than
  one without replace-all, replace-all substituting every exact occurrence, and
  `oldString != newString` — at parity with `packages/core/src/tool/edit.ts`
  `countOccurrences` semantics and identical error messages via the C4 mapping — plus
  `packages/core/src/tool/native/edit.native.ts` and its parity fixtures (FR3, FR18, C4, AC4).
  Acceptance: `cargo test -p opencode-tools-ffi` and `bun test packages/core/test/tool/native`
  assert the zero/one/many + replace-all matrix with the exact TS `ToolFailure` messages.
- [ ] T011 [S9] Author `crates/opencode-tools-ffi/src/patch.rs` (`oc_apply_patch`) with
  multi-hunk parse + apply, per-hunk surrounding-context matching, and the typed
  `context_mismatch` error that applies **nothing** on a mismatch — at parity with
  `packages/core/src/tool/apply-patch.ts` — plus
  `packages/core/src/tool/native/apply-patch.native.ts` and its parity fixtures (FR4, FR18,
  C4, AC5). Acceptance: `cargo test -p opencode-tools-ffi` and
  `bun test packages/core/test/tool/native` assert all hunks apply on a matching patch and a
  non-matching hunk yields `context_mismatch` with no partial application.
- [ ] T012 [S10] Author `crates/opencode-tools-ffi/src/glob.rs` (`oc_glob`) as
  `.gitignore`-aware file-pattern search via `ignore` + `globset` sorted by modification time
  (mtime-desc), plus `packages/core/src/tool/native/glob.native.ts` whose selection falls back
  through the `Ripgrep.Service` seam in `packages/core/src/tool/glob.ts`; extend the parity
  suite with repo-level equivalence over the opencode repo ignoring the undefined
  `(mtime desc, path)` tie order (FR5, FR7, FR18, C5, C13, AC1, AC6). Acceptance:
  `cargo test -p opencode-tools-ffi` and `bun test packages/core/test/tool/native` assert
  ignored paths are excluded, results are mtime-ordered, the repo corpus matches after tie
  normalization, and the fallback routes through the Ripgrep seam.

### PTY crate and shell integration (Phase 4)

- [ ] T013 [S11] Author `crates/opencode-pty-ffi/Cargo.toml` (cdylib, inheriting the abi
  rlib + `portable-pty`/`libc`) and `crates/opencode-pty-ffi/src/lib.rs` with the five
  synchronous, `catch_unwind`-wrapped entry points: `oc_pty_spawn` (allocate a PTY and spawn
  via `portable-pty` with `setsid`, a controlling TTY, and its own pgid, returning
  `{ session_id, pid, master_fd }` so the child observes `isatty() == true`), `oc_pty_resize`
  (`TIOCSWINSZ`), `oc_pty_kill` (`killpg` — one signal to the child's process group),
  `oc_pty_wait` (`waitpid` `WNOHANG`), and `oc_pty_close` (idempotent single-owner teardown);
  **no Tokio or async runtime** — the boundary is synchronous and a future phase-2 manager
  must not change this contract (FR8, FR9, FR11, NFR5, C7, C9, C11, C12, AC8, AC9).
  Acceptance: `cargo build --release -p opencode-pty-ffi`, `cargo clippy` clean, and
  `cargo test -p opencode-pty-ffi` assert spawn returns the triple with a controlling TTY,
  resize applies the window size, `killpg` targets the group, `waitpid` is non-blocking, and
  `close` is idempotent — with no async runtime linked.
- [ ] T014 [S12] Author `packages/core/src/tool/native/pty-registry.ts`
  (`session_id → { pid, master_fd, pgid, stream }` with the single-owner fd contract) and
  `packages/core/src/tool/native/pty-reader.ts` reading/writing the `master_fd` through
  `node:net.Socket({ fd })` with `O_NONBLOCK` on Bun's event loop (kqueue/epoll) — **no FFI
  call on the IO hot path** — feeding the existing bash output sink under the unchanged
  `MAX_CAPTURE_BYTES` cap so the master fd is owned and closed exactly once by Bun (FR10,
  FR23, NFR4, C9, C10, C20, AC10). Acceptance: `bun run typecheck` on `packages/core` green
  and `bun test packages/core/test/tool/native` asserts a streaming session stays responsive,
  the fd is closed exactly once, and output flows to the sink under `MAX_CAPTURE_BYTES` with
  no FFI on the hot path.
- [ ] T015 [S13] Extend `packages/core/src/tool/bash.ts` with the opt-in `pty: true` route
  that spawns through `opencode-pty-ffi` — **`permission.assert` evaluated FIRST**, before any
  PTY allocation or spawn (the security invariant: native code never evaluates, caches, or
  bypasses permissions) — with the TS-driven `SIGKILL` escalation 3 s after the initial
  `SIGTERM` mirroring `forceKillAfter`, the default (`pty` unset/false) path left byte-for-byte
  unchanged, and `win32 pty:true` degrading to `ChildProcess` with an advisory
  `native_unavailable`; introduce `experimental.nativePty` (default `false`) in
  `packages/core/src/config/experimental.ts` as the gate (FR12, FR13, NFR5, C12, C19, C20,
  AC9, AC15, AC16). Acceptance: `bun run typecheck` on `packages/core` green and
  `bun test packages/core/test/tool/native` asserts `permission.assert` precedes every spawn,
  the 3 s SIGKILL escalation fires, the default path is unchanged, and `win32` degrades.
- [ ] T016 [S13] Add the PTY acceptance tests under `packages/core/test/tool/native/`:
  terminal fidelity (`isatty() == true` + ANSI color from a probe command spawned via
  `oc_pty_spawn`), full-tree kill (a child that forks a subprocess tree is fully terminated
  by `oc_pty_kill` on the pgid with no orphans), the non-blocking event loop (a long-running
  streaming session keeps the agent responsive with output via the Bun master-fd reader), the
  permission-gate-first ordering for `bash pty:true`, and the default-bash-unchanged path
  (`pty` unset/false keeps the `ChildProcess`/`AppProcess` timeout/capture/output semantics)
  (FR8, FR9, FR10, FR12, FR13, NFR4, NFR5, C9, C11, C12, AC8, AC9, AC10, AC15, AC16).
  Acceptance: `bun test packages/core/test/tool/native` green across terminal fidelity,
  full-tree kill, non-blocking streaming, permission-first ordering, and the unchanged default
  bash path.
- [ ] T017 [S14] Finalize the Config flags and platform gate: `experimental.nativeTools` and
  `experimental.nativePty` are optional booleans defaulting `false` in
  `packages/core/src/config/experimental.ts` (Feature 007 `experimental.*` precedent), their
  **presence never changes behavior when off**, and `win32` always takes the TypeScript path;
  add the config-level tests asserting default-off and presence-is-inert (FR12, FR19, FR22,
  NFR6, C2, C19, AC13, AC16). Acceptance: `bun run typecheck` on `packages/core` green and
  `bun test packages/core` assert both flags default `false`, a present-but-off flag runs the
  TS path byte-identically, and `win32` never selects native.

### Stress, telemetry, build pipeline, and close-out (Phase 5)

- [ ] T018 [S15] Add the leak-and-panic stress suite under
  `packages/core/test/tool/native/`: issue a high volume (target ≥ 100k, the exact count a
  provisional constant finalized here per AC11) of `oc_*` calls each freeing its response via
  `oc_free`, assert `oc_alloc_stats.allocated == freed` at rest and a bounded RSS ceiling, and
  a panic-injection test asserting a native entry point that panics internally returns the
  `internal_panic` envelope with the Bun process not crashing (FR16, FR17, FR20, NFR2, NFR3,
  C18, AC11, AC12). Acceptance: `bun test packages/core/test/tool/native` green with matched
  alloc/free at rest, RSS within the ceiling, and the contained `internal_panic` path.
- [ ] T019 [S16] Author the content-free telemetry for backend selection and the
  `native_unavailable` gap following ADR-0001 / Feature 001 bounded-label conventions: labels
  `tool` (the six names + `pty`), `backend` (`native` | `typescript`), and `gap_reason`
  (`library_missing` | `dlopen_failed` | `abi_mismatch` | `disabled`) — stable enums only —
  plus the PTY spawn/kill/close lifecycle counters; **no file contents, paths, patch bodies,
  command strings, or session ids** appear as labels, and Feature 010 adds no new exporter,
  SDK, or output plane (FR23, FR24, C14, AC17). Acceptance: `bun test packages/core` cardinality
  audit asserts only the bounded enum labels appear and no content/path/command/session-id
  label is emitted.
- [ ] T020 [S16] Add the fallback byte-identity suite under
  `packages/core/test/tool/native/` covering all six tools when the dylib is
  absent / present-but-unloadable / ABI-mismatched / flag-off: each runs through the
  TypeScript implementation byte-identically and records the typed `native_unavailable`
  capability gap with the correct bounded `gap_reason`, and the session never hard-fails
  (FR7, FR19, NFR1, NFR6, C14, AC13, AC14). Acceptance: `bun test packages/core/test/tool/native`
  green with all six tools byte-identical on the TS path across every unavailability cause and
  the gap recorded, no hard failure.
- [ ] T021 [S16] Author `script/build-native.ts` (a Bun script invoking `cargo build
  --release` at the workspace root and copying `libopencode_tools_ffi.{dylib,so}` /
  `libopencode_pty_ffi.{dylib,so}` into `packages/core/native/<platform>-<arch>/`, `<arch>` =
  `arm64`|`x64` — the exact copy layout a provisional constant finalized here per AC14) and
  wire the `build:native` script into the root `package.json`; add the CI note (macOS + Linux
  build, `cargo fmt --check` + `clippy`, toolchain-pin gate, parity + stress suites), never
  install-time — Bun `postinstall` does not build Rust, so absence of an artifact triggers the
  FR19 fallback rather than a build/runtime failure. **Honest provenance:** if CI cannot build
  Rust, this task records the typed consequence (the platforms exercised, the fallback that
  serves the rest) and never fakes a green build (FR21, FR22, C17, AC18). Acceptance:
  `bun run build:native` builds both crates and copies the artifacts into the gitignored
  bundled dir on a Rust-capable machine, and an absent artifact leaves the TypeScript build
  and runtime intact.
- [ ] T022 [S16] Close out: run `cargo build --release` + `cargo clippy` + `cargo test`
  across all three crates and `bun run typecheck` + `bun test` for `packages/core`; tick every
  checkbox above once its task is complete and verified; confirm `speckit validate` is green
  with only the four pre-existing waived hygiene findings (no placeholder findings); and
  confirm every FR1–FR24, NFR1–NFR6, and AC1–AC18 is mapped to a task per the Traceability
  section (FR20, FR24, C13, C18). Acceptance: all three crates build/lint/test green,
  `packages/core` typechecks and tests green, `speckit validate` green, and the Traceability
  tables are fully mapped.

## Traceability

Requirements-to-task, non-functional-to-task, and acceptance-to-task coverage. The
`#FfiResponse` envelope, the closed 13-value `error.code` taxonomy, the `#PtySessionEntry` /
`#PtySpawnResult` / per-tool request-result shapes, and the bounded telemetry-label enums are
the `doc/arch/schemas/ffi/*.cue` / `data-model.md` authority; the TypeScript parity constants
remain the conceptual source of truth mirrored in Rust `const` and test-locked through
`oc_version` introspection (T003, T008).

| Requirement | Tasks |
| ----------- | ----- |
| FR1 read parity (windowing/caps/binary/UTF-8/offset) | T004, T008 |
| FR2 write create/overwrite + atomic rename | T009 |
| FR3 edit exact replacement + uniqueness + replace-all | T010 |
| FR4 apply_patch multi-hunk + typed context mismatch | T011 |
| FR5 glob .gitignore-aware + mtime sort | T007, T012 |
| FR6 grep embedded engine; no external rg spawn | T005, T007 |
| FR7 six tools byte-identical; ties ignored | T008, T012, T020 |
| FR8 oc_pty_spawn setsid + controlling TTY + isatty | T013, T016 |
| FR9 resize/kill/wait/close; full-tree kill | T013, T016 |
| FR10 async IO on Bun; no FFI on hot path | T014, T016 |
| FR11 no Tokio phase 1; synchronous boundary | T013 |
| FR12 bash pty:true opt-in; default unchanged | T015, T016, T017 |
| FR13 permission gate in TS before spawn | T015, T016 |
| FR14 extern "C" oc_<name> JSON in/out via serde | T002, T004 |
| FR15 structured JSON `{ code, message }` errors | T002 |
| FR16 catch_unwind on every entry point | T002, T018 |
| FR17 oc_free sole dealloc; freed exactly once | T002, T018 |
| FR18 transparent TS wrappers per tool | T007, T009, T010, T011, T012 |
| FR19 lazy dlopen; silent native_unavailable fallback | T006, T017, T020 |
| FR20 parity suite + memory-leak stress | T008, T018 |
| FR21 cargo workspace builds both crates; absence inert | T001, T021 |
| FR22 macOS/Linux first; win32 phase 2; contract fixed | T006, T017, T021 |
| FR23 outputs flow to Feature 005; no second plane | T014, T015, T019 |
| FR24 content-free bounded-label telemetry | T019 |

| Non-functional | Tasks |
| -------------- | ----- |
| NFR1 deterministic byte-identical results | T008, T020 |
| NFR2 panic-safe; no unwind into Bun | T002, T018 |
| NFR3 leak-free under stress; oc_free once | T002, T018 |
| NFR4 event loop never blocks on PTY IO | T014, T016 |
| NFR5 oc_pty_kill terminates full tree | T013, T016 |
| NFR6 native absent → no behavioral change | T017, T020 |

| Acceptance | Tasks |
| ---------- | ----- |
| AC1 six-tool parity | T008, T012, T020 |
| AC2 read windowing parity | T004, T008 |
| AC3 atomic write | T009 |
| AC4 edit uniqueness | T010 |
| AC5 multi-hunk patch | T011 |
| AC6 glob honors gitignore + mtime | T012 |
| AC7 grep embedded parity; no rg spawn | T005, T008 |
| AC8 PTY is a real terminal (isatty/ANSI) | T016 |
| AC9 full-tree kill | T013, T016 |
| AC10 non-blocking event loop | T014, T016 |
| AC11 no boundary leak | T018 |
| AC12 panic contained | T018 |
| AC13 library absent — silent fallback | T017, T020 |
| AC14 load failure — graceful degrade | T006, T020 |
| AC15 permission gate stays in TypeScript | T015, T016 |
| AC16 default bash unchanged | T016, T017 |
| AC17 content-free telemetry | T019 |
| AC18 release build produces loadable artifacts | T021 |

## Dependencies

Internal sequencing and cross-feature seams.

- **Phase order.** Phase 1 (T001–T003) precedes Phase 2 (T004–T008) precedes Phase 3
  (T009–T012) precedes Phase 4 (T013–T017) precedes Phase 5 (T018–T022). The
  `opencode-ffi-abi` rlib (T002/T003) gates both `cdylib` crates; `loader.ts` (T006) gates
  every TS wrapper; the parity harness + fixtures (T008) gate the Phase 3/4 parity extensions.
- **Toolchain and pins are fixed, not provisional.** Crate versions (`serde 1.0.229`,
  `serde_json 1.0.150`, `ignore 0.4.30`, `globset 0.4.19`, `grep-searcher 0.1.17`,
  `grep-regex 0.1.14`, `grep-matcher 0.1.9`, `portable-pty 0.9.0`, `libc 0.2.186`) and the
  FFI symbol surface are pinned by `plan.md`. Provisional constants (bundled subpath layout,
  `build:native` copy layout, stress iteration count, RSS ceiling, pinned toolchain channel)
  carry named acceptance hooks (AC11, AC13, AC14, AC18) and are finalized in T017/T018/T021.
- **Feature 007 (Operator Control Plane).** The `permission.assert` gate stays in TypeScript
  (PermissionV2), evaluated before every native call and every PTY spawn (T015, T016); the
  `experimental.*` Config-flag precedent seats `nativeTools`/`nativePty` in
  `packages/core/src/config/experimental.ts` (T007, T015, T017). Native code never becomes a
  permission authority.
- **Feature 005 (OutputSpool).** Native and PTY outputs flow to the existing output plane as
  refs through the tools' current output path; Feature 010 introduces no second plane and does
  not re-specify OutputSpool. The PTY sink reuses the unchanged `MAX_CAPTURE_BYTES` cap (T014,
  T015, T019).
- **Feature 006 (Semantic Retrieval).** The `milvus_unavailable` typed capability-gap posture
  is the precedent the `native_unavailable` fallback mirrors (T006, T020).
- **Feature 001 (Smart Routing / Telemetry) + ADR-0001.** Content-free bounded-label
  conventions govern the backend-selection and gap signals (T019).
- **bun:ffi precedents.** `loader.ts` reuses the proven `dlopen` + `read.ptr`/`CString`
  pattern from `packages/tui/src/terminal-win32.ts` (kernel32) and
  `packages/opencode/src/operator/adapters/outbound/keychain-darwin.ts` (Security.framework)
  (T006). The `node:net.Socket({ fd })` + `O_NONBLOCK` master-fd reader is empirically
  validated (research.md) and keeps async IO off the FFI boundary (T014).
- **Honest-provenance seam.** The `build:native` + CI task (T021) is delivered honestly: if a
  CI runner cannot build Rust, the task records the typed consequence (platforms exercised,
  the TypeScript fallback that serves the rest) and never fakes a green build; artifact absence
  is a fallback, not a failure.
</content>
