# Native Rust FFI Tools and PTY Research

Feature: [010 Native Rust FFI Tools and PTY Integration](spec.md)

This note records the empirical audit backing the Feature 010 plan. Every toolchain
probe, `bun:ffi` surface check, fd-read finding, and parity constant below was run or
read against the working tree and the local machine on 2026-07-19. Anchors and probe
outputs are evidence for the plan, not authorization to implement. It verifies the Rust
and Bun substrate the plan depends on, records the honest `node:net.Socket({ fd })`
finding, and cites the exact TypeScript parity constants Rust must mirror.

## Toolchain availability (local machine)

- **Rust:** `rustc 1.95.0 (59807616e 2026-04-14) (Homebrew)`, `cargo 1.95.0`. Host
  `aarch64-apple-darwin`; installed target `aarch64-apple-darwin`. `rustup` is present
  with multiple toolchains (`1.85`, `1.87`, `1.89.0`, `1.95`, `1.96.0`, `nightly`), so the
  `rust-toolchain.toml` pin at `channel = "1.83.0"` (C15) resolves to a stable ≤ the local
  `1.95.0` and builds locally without an install. No `Cargo.toml` exists in the tree yet —
  Feature 010 is the first Rust in the repository (confirmed; matches the spec).
- **Bun:** `1.3.14` at `/Users/farchanjo/.bun/bin/bun`. `bun:ffi` is available (probed
  below). This is the single runtime; native crates load through it via `dlopen`.

## `bun:ffi` `dlopen` surface (this Bun version)

Probed `import { FFIType, CString, dlopen, ptr, read } from "bun:ffi"` under Bun 1.3.14:

- `FFIType` exposes the full set the plan needs, including `ptr`, `pointer`, `void*`,
  `cstring`, `char*`, `u8`, `usize`, `i32`, `u32`, `u64`, `buffer`, `function`, `callback`.
  The `oc_<name>(req_ptr: *const u8, req_len: usize) -> *mut c_char` signature maps to
  `{ args: ["ptr", "usize"], returns: "ptr" }` (or `"cstring"` for a directly-decoded
  return); `oc_free(ptr)` maps to `{ args: ["ptr"], returns: "void" }`; `oc_abi_version()`
  to `{ args: [], returns: "u32" }`.
- `CString` is a constructor (`typeof === "function"`) — used to decode the returned
  `*mut c_char` before calling `oc_free`, the copy-then-free discipline (FR17, C7).
- `read` helpers present: `u8, u16, u32, ptr, i8, i16, i32, i64, u64, intptr, f32, f64`.
  `read.ptr` + `ptr()` + `toArrayBuffer` are the documented out-pointer pattern.
- `ptr` and `dlopen` are both functions.

### Precedent FFI sites (reuse targets — verified)

- `packages/tui/src/terminal-win32.ts:1` — `import { dlopen, ptr } from "bun:ffi"`; opens
  `kernel32.dll` with typed symbol tables (`GetStdHandle`, `GetConsoleMode`,
  `SetConsoleMode`) using `args: ["ptr", ...]` / `returns: "i32" | "ptr"` and passes
  out-buffers via `ptr(buf)`. This is the exact `dlopen` + typed-symbol pattern `loader.ts`
  reuses.
- `packages/opencode/src/operator/adapters/outbound/keychain-darwin.ts` — `dlopen` on the
  Darwin `Security.framework` + `CoreFoundation`, reading out-pointers strictly through the
  documented `read.ptr(ptr(view), 0)` / `toArrayBuffer` pattern and failing closed on a
  null/0 pointer. This is the reference for the fail-closed, copy-then-free marshalling
  `loader.ts` needs for the `*mut c_char` envelope; it also demonstrates `dlopen` via
  `require("bun:ffi")` and symbol-presence checks — the model for the ABI handshake (C7).

Conclusion: the `dlopen` seam the plan reuses is production-proven in this exact Bun
version on both the pointer-in and pointer-out directions. No new native-addon toolchain is
required (consistent with ADR-0010's rejection of `napi-rs`).

## `node:net.Socket({ fd })` under Bun — the async master-fd finding (C9, FR10)

The plan's recommended stance (C9) is that Bun owns the PTY master fd and performs async
reads/writes on the event loop via `node:net.Socket({ fd })` with `O_NONBLOCK`. This was
the highest-risk assumption, so it was probed directly under Bun 1.3.14:

```
const fd = fs.openSync("/dev/null", "r+")
const s = new net.Socket({ fd, readable: true, writable: true })
// -> Socket constructed: Socket readable=true writable=true
// RESULT: node:net.Socket({ fd }) OK
```

**Honest finding: POSITIVE.** `new net.Socket({ fd })` constructs successfully under Bun's
Node-compat layer, yielding a readable+writable stream bound to a raw fd — exactly the seam
C9 recommends for registering the PTY master fd on the event loop. No fallback path is
required for V1: the recommended stance is empirically viable on the target runtime. The
plan still records the documented alternatives (`Bun.file(fd).stream()`, or an
`fs.read`-loop with `O_NONBLOCK`) as contingencies if the raw-PTY-fd case behaves
differently from the `/dev/null` stand-in under load, but the constructor itself is
confirmed available, so the master-fd reader (`pty-reader.ts`, slice S12) is built on
`node:net.Socket({ fd })` as the primary path. The single-owner close contract (Rust never
touches the fd after `oc_pty_spawn`; Bun closes it exactly once) is unaffected by the reader
choice.

## `rg` binary resolution today (the glob/grep fallback seam — C5)

- `packages/core/src/ripgrep.ts` is the current glob/grep engine: `Ripgrep.Service`
  spawns the external `rg` binary through `ChildProcess.make` + `process.spawn`
  (`ripgrep.ts:96,109-110`), parses stdout, and maps a bad pattern to
  `Ripgrep.InvalidPatternError` (`ripgrep.ts:46,136`). The `grep`/`glob` tools call this
  service; the native embedded engine replaces the call inside `glob.ts` / `grep.ts`, and
  this external-`rg` spawn stays unchanged as the fallback (C5).
- The binary is resolved by `packages/core/src/ripgrep/binary.ts` via a platform map
  (`arm64-darwin -> aarch64-apple-darwin`, `x64-linux -> x86_64-unknown-linux-musl`, etc.,
  `binary.ts:16-22`), a `which` lookup (`util/which`), and an HTTP download of the vendored
  release when absent. So the fallback depends on a resolvable/downloadable `rg`; the native
  embedded engine (`grep-searcher`/`grep-regex`/`ignore`/`globset`) removes that spawn +
  download dependency entirely when native is enabled and loaded (FR6). The
  `Ripgrep.InvalidPatternError` maps to the FFI `invalid_pattern` code (C4).

## Exact TypeScript parity constants (Rust must mirror; test-locked — C16)

Cited from the working tree; these are the single conceptual source of truth the Rust
`const` values are asserted against (C16):

- `packages/core/src/tool/read-filesystem.ts:11` — `MAX_READ_LINES = 2_000`.
- `read-filesystem.ts:12` — `MAX_READ_BYTES = 50 * 1024` (= 51200, 50 KiB).
- `read-filesystem.ts:13` — `MAX_MEDIA_INGEST_BYTES = 20 * 1024 * 1024` (= 20971520,
  20 MiB).
- `read-filesystem.ts:14` — `MAX_LINE_LENGTH = 2_000`.
- `read-filesystem.ts:15` — suffix `... (line truncated to ${MAX_LINE_LENGTH} chars)` =
  `... (line truncated to 2000 chars)`.
- Read error classes mapped to FFI `error.code` (C4): `ReadTool.BinaryFileError`
  (`:17`) -> `binary_file`; `ReadTool.MediaIngestLimitError` (`:25`) -> `media_limit`;
  `ReadTool.MalformedUtf8Error` (`:37`) -> `malformed_utf8`;
  `ReadTool.OffsetOutOfRangeError` (`:45`) -> `offset_out_of_range`; `ReadTool.PathKindError`
  (`:54`, "Path is not a file") -> `not_a_file`.
- `packages/core/src/tool/edit.ts` — semantics for `oc_edit` parity (C4): identical
  oldString/newString rejected (`:127-129`); empty oldString rejected (`:132-134`);
  `countOccurrences` drives zero-match "Could not find oldString" (`:165-169`) ->
  `no_match`, and `>1` without `replaceAll` "Found multiple exact matches" (`:172-175`) ->
  `ambiguous_match`. Line-ending normalization: `normalizeLineEndings` collapses `\r\n` to
  `\n` then re-applies the file's ending (`:42-45,163-164`) — the native `edit` must mirror
  this CRLF handling for byte-identity.
- `packages/core/src/tool/bash.ts:21` — `MAX_CAPTURE_BYTES = 1024 * 1024` (1 MiB); the PTY
  master-fd sink reuses this cap (C20). `bash.ts:162` — `detached: process.platform !==
  "win32"` (the current process-group model); `bash.ts:163` — `forceKillAfter:
  Duration.seconds(3)` (the grace the TS-driven SIGKILL escalation mirrors, C12);
  `bash.ts:170` — `maxOutputBytes: MAX_CAPTURE_BYTES`. `bash.ts:132,142` — `permission.assert`
  is the gate the PTY route must evaluate first (FR13, C20).

## Crate versions (resolved from the crates.io sparse index, 2026-07-19)

Latest non-yanked, non-prerelease versions; pinned exactly in the plan (the pin validator
requires exact versions). `libc` intentionally uses the stable `0.2.x` line, not the
`1.0.0-alpha.3` pre-release `cargo search` surfaces first.

| Crate | Pinned | Notes |
| ----- | ------ | ----- |
| `serde` | `1.0.229` | `features = ["derive"]` |
| `serde_json` | `1.0.150` | JSON envelope |
| `ignore` | `0.4.30` | `.gitignore` walk |
| `globset` | `0.4.19` | glob matching |
| `grep-searcher` | `0.1.17` | line search |
| `grep-regex` | `0.1.14` | regex matcher |
| `grep-matcher` | `0.1.9` | matcher trait |
| `portable-pty` | `0.9.0` | PTY alloc + spawn |
| `libc` | `0.2.186` | stable line; `setsid`/`killpg`/`waitpid`/`TIOCSWINSZ` |

## CUE scaffold alignment (C3, C9)

The `doc/arch/schemas/ffi/` corpus models the normative shapes the plan references across
the `ffi.enums` / `ffi.shared` / `ffi.envelope` / `ffi.tools` / `ffi.pty` / `ffi.config`
packages: `#FfiStatus` (`"ok" | "error"`), `#FfiError` (`code`/`message`), `#FfiResponse`
(`status` + optional `result` / required `error`), the closed `#FfiErrorCode` taxonomy,
`#NativeToolName` (the six tools), `#NativeToolBackend` (`native | typescript`), the per-tool
request/result shapes, and the `#PtySessionEntry` entity plus `#PtySpawnResult` (`session_id`
/ `pid` / `master_fd`). The plan's envelope and PTY-session descriptions are consistent with
this corpus (DDD-role headers, ≤7 fields, id-bearing entities split from `-parts`); it
supersedes the single-file specify scaffold, now removed.

## Evidence boundaries

- Path anchors and line numbers may drift; they do not authorize implementation.
- Provisional constants (bundled subpath layout, `build:native` copy layout, stress
  iteration count, RSS ceiling, pinned toolchain channel) remain plan constants with named
  acceptance hooks (AC11, AC13, AC14, AC18), finalized in the tasks phase.
- The `node:net.Socket({ fd })` probe used a `/dev/null` `r+` fd as a raw-fd stand-in; the
  constructor is confirmed, and the raw-PTY-fd behavior under streaming load is validated by
  the AC10 non-blocking-event-loop test at implementation time.

## Related evidence

- [Feature 010 specification](spec.md)
- [Feature 010 plan](plan.md)
- [ADR-0010 Native Rust FFI Layer for Built-in Tools and PTY](../../adr/0010-add-native-rust-ffi-layer-for-built-in-tools-and-pty.md)
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- [Feature 006 Milvus Semantic Retrieval](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- [ADR-0001 OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
