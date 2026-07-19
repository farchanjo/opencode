---
status: proposed
date: 2026-07-19
deciders: [project maintainers]
consulted: []
informed: []
---

# 0010 — Native Rust FFI Layer for Built-in Tools and PTY

## Context and Problem Statement

OpenCode runs exclusively on Bun and exposes twelve built-in tools in
`packages/core/src/tool/` (composed in `builtins.ts`). Six of them —
`read`, `write`, `edit`, `apply_patch`, `glob`, `grep` — are pure filesystem/text
processing implemented in TypeScript. Two costs are visible: `glob` and `grep` shell out
to an external `rg` binary through `packages/core/src/ripgrep.ts` (`ChildProcess`
spawn), and the shell tool (`packages/core/src/tool/bash.ts`) spawns children with no
controlling terminal, so interactive/color-aware commands see `isatty() == false`.

Bun already exposes FFI via `bun:ffi` `dlopen`, and the repository already uses it in
production (`packages/tui/src/terminal-win32.ts` for kernel32 console mode;
`packages/opencode/src/operator/adapters/outbound/keychain-darwin.ts` for the Darwin
Security.framework). No Rust exists in the repository yet — there is no `Cargo.toml` and
no cargo workspace. Feature 010 asks how to add native, faster, higher-fidelity
implementations for the six filesystem/text tools and a real PTY for the shell tool
**without** making native code a hard dependency, a permission authority, or a source of
behavioral drift.

## Decision Drivers

- Behavioral parity is mandatory: native results MUST be byte-identical to the TypeScript
  references on shared fixtures, so tool behavior never depends on which backend loaded.
- Native code MUST be optional and non-breaking: a missing or unloadable library degrades
  silently to today's TypeScript path with no observable change and no hard failure.
- The permission/approval gate (Feature 007 PermissionV2) MUST stay in TypeScript and be
  evaluated before every native call and every PTY spawn — native code is never a
  permission authority.
- The FFI boundary MUST be panic-safe and leak-free: no Rust unwind may cross into Bun,
  and every Rust-allocated response is freed exactly once.
- The async IO hot path (PTY streaming) MUST stay on Bun's event loop; the FFI boundary is
  synchronous in phase 1 with no embedded async runtime.
- Reuse the proven `bun:ffi` `dlopen` seam already in the codebase rather than a new
  native-addon toolchain.

## Considered Options

- **Status quo (pure TypeScript).** Keep all six tools in TypeScript and keep spawning the
  external `rg` binary; keep the shell tool without a PTY.
- **`napi-rs` native addon.** Build a Node-API `.node` addon in Rust.
- **WebAssembly (wasm).** Compile the Rust logic to wasm and run it in-process.
- **Rust `cdylib` via `bun:ffi` `dlopen` (chosen).** Two `cdylib` crates loaded through
  the same `dlopen` seam already used for kernel32 and Security.framework, behind a
  synchronous JSON FFI contract with lazy load and TypeScript fallback.

## Decision Outcome

Chosen option: **Rust `cdylib` via `bun:ffi` `dlopen`**, because it reuses the FFI seam
already proven in the codebase, keeps Bun as the single async runtime, gives native code
direct access to the PTY master fd and to embedded ripgrep (`grep-searcher`, `grep-regex`,
`ignore`, `globset`) without spawning `rg`, and loads lazily so a missing artifact falls
back to the existing TypeScript implementation with no behavioral change.

The other options were rejected: the status quo leaves the external-`rg` spawn and the
no-TTY shell in place; `napi-rs` introduces a second, heavier native-addon toolchain and
Node-API surface the project does not otherwise use; wasm cannot deliver a real PTY with a
controlling TTY or process-group signaling, which is a core deliverable.

The contract is fixed as: `extern "C" fn oc_<name>(req_ptr: *const u8, req_len: usize) ->
*mut c_char` with `serde` JSON request/response, `{ ok: false, error: { code, message } }`
errors (never numeric return codes), `catch_unwind` on every entry point, and responses
freed only through the exported `oc_free`. Two crates ship: `opencode-tools-ffi` (the six
filesystem/text tools) and `opencode-pty-ffi` (`oc_pty_spawn`/`resize`/`kill`/`wait`/
`close`). The shell tool gains opt-in `pty: true` with the permission gate still in
TypeScript. macOS and Linux ship first; Windows ConPTY is phase 2 and MUST NOT change the
FFI contract; no Tokio/async runtime is introduced in phase 1.

### Consequences

- Good: `grep`/`glob` stop spawning an external `rg` process; the shell tool can offer a
  real terminal (`isatty() == true`, ANSI colors, full-tree kill via process group); the
  boundary is panic-safe and leak-free by contract.
- Good: native execution is fully optional — the typed `native_unavailable` capability gap
  (mirroring the `milvus_unavailable` precedent) drives a silent, behavior-identical
  fallback, so shipping without the compiled library changes nothing.
- Good: telemetry stays content-free (ADR-0001); tool outputs still flow to the Feature 005
  OutputSpool; no second registry, output plane, or event system is introduced.
- Bad: the repository gains its first Rust toolchain and a cargo workspace to build and pin
  in CI, plus a parity + memory-leak stress suite to keep native and TypeScript aligned.
- Bad: the FFI boundary must be maintained carefully (single-owner fd contract,
  `oc_free` discipline, `catch_unwind` on every entry point); mistakes there are memory
  bugs rather than TypeScript exceptions.
