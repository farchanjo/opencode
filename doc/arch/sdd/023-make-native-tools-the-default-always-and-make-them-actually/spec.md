---
id: 019f7f01-035e-7f42-883f-5f87a5f1bdee
number: 023
slug: make-native-tools-the-default-always-and-make-them-actually
status: implemented
created_at: 2026-07-20T10:10:00.67073Z
---
# Feature Specification: Make Native Tools The Default Always And Make Them Actually Load From The Compiled Binary

Feature: 023-make-native-tools-the-default-always-and-make-them-actually
Created: 2026-07-20
Scope: The Feature 010 native Rust FFI backend for the built-in tools and PTY is
proven (parity, byte-identical fallback, leak/panic stress, ABI handshake) but stays
dark in production for two reasons this feature fixes. (1) The two experimental flags
`experimental.native_tools` / `experimental.native_pty` are optional booleans that
**default false**, and the three wired gates read them as `=== true`
(`packages/core/src/tool/glob.ts:91`, `grep.ts:116`, `bash.ts:182`), so an absent
flag takes the TypeScript/ripgrep/ChildProcess path — native is opt-in. (2) The
loader's bundled-dylib rung resolves from `import.meta.dir`
(`packages/core/src/tool/native/loader.ts:227-229`,
`defaultBundledBaseDir()`), which inside a `bun build --compile` single-file binary
is the virtual `/$bunfs/root` namespace — a **dead** rung — and the compile step
(`packages/opencode/script/build.ts`) ships **no dylib** into `dist/`. So even
forced on, a compiled binary finds no library and silently falls back. This feature
(A) makes `native_tools` and `native_pty` **default ENABLED** unless explicitly set
`false`, preserving the silent fallback, the win32 disable, and the explicit
opt-out; and (B) makes native **actually load from a compiled/deployed binary** by
adding a discovery rung anchored on `process.execPath` and by shipping the built
dylibs co-located next to the binary in `dist/`. It does **not** wire the
`read`/`write`/`edit`/`apply_patch` native wrappers — those stay unwired (documented
follow-up, ADR-0023).

## Grounding (every anchor verified 2026-07-20)

- **Gate flag schema.** `packages/core/src/config/experimental.ts:29`
  `native_tools: Schema.Boolean.pipe(Schema.optional)`, `:31` `native_pty`. Absent ⇒
  `undefined` (falsy) ⇒ opt-in today.
- **Wired call sites (ONLY these check the flag).**
  `packages/core/src/tool/glob.ts:91-92`, `packages/core/src/tool/grep.ts:116-117`,
  `packages/core/src/tool/bash.ts:182-183` (native_pty). `read`/`write`/`edit`/
  `apply_patch` do NOT check the flag — their native wrappers exist but are unwired.
- **Safe fallback exists.** `glob.ts:92-100` returns native only on
  `outcome.kind === "ok"`, else falls through to `ripgrep.glob(...)`; `grep.ts` the
  same; `loader.ts:158-159` returns typed gaps (never throws), win32 hard-disabled.
- **Dylib discovery ladder.** `loader.ts:discover()` — rung1
  `OPENCODE_TOOLS_FFI_PATH`/`OPENCODE_PTY_FFI_PATH`; rung2 `OPENCODE_NATIVE_LIB_DIR`;
  rung3 bundled `path.join(bundledBaseDir, "<platform>-<arch>", "<stem>.<ext>")`,
  `bundledBaseDir = defaultBundledBaseDir()` = `path.resolve(import.meta.dir,
  "../../../native")`. Inside a compiled binary `import.meta.dir` = `/$bunfs/root` ⇒
  rung3 is DEAD; the dylib is never embedded/co-located.
- **Dylibs are build output.** `bun run build:native` (`script/build-native.ts`)
  emits the gitignored `packages/core/native/<platform>-<arch>/*.{dylib,so}`. The
  compile step `packages/opencode/script/build.ts` (`Bun.build` compile) ships NO
  dylib.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Native tools are the default without opting in

- As a user, I want the proven native `glob`/`grep`/`bash pty` backends to serve my
  requests by default — without setting any experimental flag — so that I get the
  embedded engines out of the box, with the TypeScript/ripgrep path as a silent
  safety net.

### P1 — Native actually loads from a compiled/deployed binary

- As a release engineer, I want a compiled `opencode` (e.g. `/opt/opencodev2/opencode`)
  to resolve and `dlopen` its co-located native dylib at runtime — not silently fall
  back because `import.meta.dir` is `/$bunfs/root` and no dylib was shipped — so that
  "native by default" is true in production, not just in a dev checkout.

### P1 — The explicit opt-out and the silent fallback are preserved

- As an operator, I want `experimental.native_tools=false` / `native_pty=false` to
  still fully disable native, and any `NativeUnavailable` gap (missing library,
  `dlopen` failure, ABI mismatch, win32) to still fall back silently to the
  TypeScript path with no hard crash — so that the escape hatch and the safety net
  from Feature 010 are intact.

### P2 — The release build fails loudly rather than shipping native-less

- As a release engineer, I want the build to fail with a clear message if it would
  ship a current-platform binary without its dylibs, so that the "recommended but
  unavailable" gap cannot recur silently.

## Functional Requirements

### Group A — Native is the default, opt-out preserved (FR-A)

1. **FR-A1 — The three wired gates default ON.** `glob.ts`, `grep.ts`, and `bash.ts`
   MUST read the flag as `!== false` (`Config.latest(entries,
   "experimental")?.native_tools !== false`; `native_pty !== false` for bash), so an
   **absent** flag selects native and only an **explicit** `false` opts out. The
   change MUST be consistent across all three gates. The schema fields stay optional
   booleans; the effective default lives in the gate operator.
2. **FR-A2 — Explicit `false` fully disables.** `experimental.native_tools=false`
   MUST take the TypeScript/ripgrep path for `glob`/`grep`; `native_pty=false` MUST
   take the ChildProcess path for `bash pty:true`. Explicit `true` is unchanged.
3. **FR-A3 — The silent fallback and win32 disable are PRESERVED.** Native is
   returned only on `outcome.kind === "ok"`; every `NativeUnavailable` gap
   (`library_missing`, `dlopen_failed`, `abi_mismatch`, `disabled`) MUST fall through
   the existing TS/ripgrep/ChildProcess seam with no hard crash. win32 MUST stay hard
   disabled at the loader.
4. **FR-A4 — The unwired wrappers stay out of scope.** `read`/`write`/`edit`/
   `apply_patch` native wrappers MUST NOT be wired by this feature; the default flip
   applies to the already-wired `glob`/`grep`/`bash pty` surface only. Recorded as a
   documented follow-up in ADR-0023.

### Group B — Native actually loads from a compiled binary (FR-B)

5. **FR-B1 — A compiled-binary discovery rung anchored on `process.execPath`.**
   `loader.ts:discover()` MUST add a rung that resolves the dylib relative to the
   real executable location — `path.dirname(process.execPath)` — in the co-located
   layout `<execDir>/native/<platform>-<arch>/<stem>.<ext>`. It MUST be
   `fileExists`-guarded so it only fires when a real dylib is present (a compiled
   binary), and is inert in a dev checkout. rung1 (per-crate env), rung2
   (`OPENCODE_NATIVE_LIB_DIR`), the dev bundled rung (`import.meta.dir`), and the
   typed-gap fallback MUST all be preserved; win32 still never `dlopen`s.
6. **FR-B2 — The build ships the dylibs co-located.** `packages/opencode/script/
   build.ts` MUST copy the built `libopencode_tools_ffi` / `libopencode_pty_ffi`
   dylibs from `packages/core/native/<platform>-<arch>/` into
   `dist/<name>/bin/native/<platform>-<arch>/` for the current-platform target — the
   exact layout the FR-B1 rung expects. If the dylibs are absent at build time it
   MUST trigger `bun run build:native`; if still absent it MUST fail with a clear
   message (never silently ship a native-less current-platform binary). The existing
   `rm -rf ./dist/<name>/bin/tui` and web-ui embed behavior MUST stay intact.
   Cross-compiled targets carry no host dylib and fall back to the TS path.
7. **FR-B3 — An honest native-load diagnostic.** The loader MUST expose a
   content-free `probeNativeStatus()` reporting which rung resolved, the resolved
   path, whether it loaded, the gap reason, `import.meta.dir`, and `execDir`; and an
   `OPENCODE_NATIVE_DEBUG` stderr line on the shared loader's first load. Neither may
   log file content, command strings, patch bodies, or session ids (Security,
   ADR-0001).

## Non-Functional Requirements

- **Minimal, centralized change.** Flip the default with one operator per gate
  (`!== false`); do not fork behavior across the three call sites.
- **No parity, catalog, or dispatch change.** The native execution path, its parity
  guarantees, catalog version, dispatch path, and public payloads are unchanged; only
  the default selection and the dylib discovery/shipping change.
- **Deployable layout.** The dylib is a real on-disk file beside the executable
  (`dlopen`-able), never a `/$bunfs/root` asset.
- **Honest provenance.** A native-less current-platform build fails loudly; a green
  build is never faked.

## Acceptance Scenarios

Given the opencode workspace at HEAD on branch 023

- **Absent flag selects native by default (FR-A1, P1).**
  Given no `experimental` block, When a `glob`/`grep` runs (or `bash pty:true`), Then
  the gate evaluates `!== false` ⇒ native is attempted (and served when the dylib
  loads), not the TypeScript path.

- **Explicit false opts out (FR-A2).**
  Given `experimental.native_tools=false` (or `native_pty=false`), When the tool
  runs, Then the TypeScript/ripgrep/ChildProcess path serves it.

- **A gap falls back silently (FR-A3).**
  Given the dylib is missing / `dlopen` fails / ABI mismatches / platform is win32,
  When the tool runs with the default on, Then it falls through to the TS/ripgrep/
  ChildProcess path with no hard crash.

- **The compiled binary loads native from the co-located dylib (FR-B1, FR-B2, P1).**
  Given `bun run build --single` shipped the dylibs into
  `dist/<name>/bin/native/<platform>-<arch>/`, When a `bun build --compile` binary in
  that directory runs the loader, Then `import.meta.dir` is `/$bunfs/root` (dev rung
  dead), discovery resolves via the `exec_colocated` rung, and the crate `dlopen`s +
  passes the ABI handshake (`loaded:true`).

- **The build fails loudly without dylibs (FR-B2, P2).**
  Given the current-platform dylibs cannot be produced, When `bun run build --single`
  runs, Then it exits non-zero with a clear message rather than shipping a
  native-less binary.

- **The diagnostic is content-free (FR-B3).**
  Given `probeNativeStatus()` / `OPENCODE_NATIVE_DEBUG`, When native loads or falls
  back, Then only the resolved dylib path + bounded load outcome is reported — no file
  content, command string, or session id.

## Security Requirements

- **Data sensitivity/classification.** Not applicable as a new data surface — this
  feature changes which backend (native vs TypeScript) serves the SAME `glob`/`grep`/
  `bash` requests and where the dylib is discovered/shipped. It reads no new data; the
  native path's data handling is the proven Feature 010 behavior, unchanged.
- **Authentication/authorization.** Not applicable — no authenticated surface,
  credential, or permission boundary is introduced or altered. The permission-first
  ordering for `bash pty:true` (permission asserted before any spawn, native or
  ChildProcess) is preserved verbatim; native code never becomes a permission
  authority.
- **Input validation.** The dylib discovery path is derived from `process.execPath`
  and fixed stem/extension literals, never from untrusted or config-supplied input,
  so no path-injection surface is added. The env overrides
  (`OPENCODE_TOOLS_FFI_PATH` etc.) are operator-controlled and unchanged from Feature
  010. The dylib is loaded only after the ABI-major handshake; a mismatch is a bounded
  `abi_mismatch` gap, not a load.
- **Cryptography in transit/at rest.** Not applicable — this feature moves no data
  across a boundary and persists nothing beyond copying a build-output dylib into the
  dist tree at build time.
- **Logging/audit.** The new `probeNativeStatus()` / `OPENCODE_NATIVE_DEBUG`
  diagnostic emits only content-free fields (rung, resolved dylib path, load outcome,
  `import.meta.dir`, semver) — never file content, patch bodies, command strings, or
  session ids, matching the ADR-0001 bounded-label discipline.
- **Error-handling information exposure.** Preserved — every native failure maps to a
  bounded `NativeUnavailableGapReason` and falls back silently; error detail carries a
  bounded reason string (`String(error)` for `dlopen_failed`), never a raw payload.
  The build's loud-fail message names only the missing dylib stems and the fix
  command.

## Observability

This feature adds no new exporter, SDK, or pipeline. Native backend selection
continues to project the Feature 010 / ADR-0001 `native.*` telemetry (bounded,
content-free labels via `boundEnum`) through the existing OTLP foundation. The new
`probeNativeStatus()` / `OPENCODE_NATIVE_DEBUG` diagnostic is an out-of-band,
content-free operator aid (not a telemetry surface): it reports the resolved rung,
dylib path, and load outcome so an operator can confirm native loaded from a deployed
binary. Metric label sets stay bounded; no file content or command string is ever a
label. Conventions live in `doc/arch/observability/observability.md`.

## Domain Model

The default-on gate and the compiled-binary discovery ladder:

```
gate (glob/grep/bash) : experimental.native_tools !== false   ⇒ absent ⇒ ON     (FR-A1)
                        experimental.native_tools === false    ⇒ TS/ripgrep path (FR-A2)
                        any NativeUnavailable gap              ⇒ silent fallback (FR-A3)
                        win32                                  ⇒ never dlopen    (FR-A3)

discover() ladder (loader.ts):
  1 per-crate env   OPENCODE_TOOLS_FFI_PATH / OPENCODE_PTY_FFI_PATH   (kept)
  2 override dir    OPENCODE_NATIVE_LIB_DIR                            (kept)
  3 exec_colocated  <dirname(process.execPath)>/native/<plat-arch>/   (NEW, FR-B1)
  4 dev bundled     <import.meta.dir>/../../../native/<plat-arch>/     (kept; dead in compiled binary)
  5 none            library_missing gap ⇒ fallback                    (kept)

build.ts : copy packages/core/native/<plat-arch>/*.{dylib,so}
           -> dist/<name>/bin/native/<plat-arch>/    (current platform; FR-B2)
           absent ⇒ run build:native ⇒ still absent ⇒ exit 1 (loud fail)

proof : a bun build --compile binary reports importMetaDir=/$bunfs/root,
        rung=exec_colocated, loaded=true (dlopen + ABI handshake)      (FR-B, decisive)

Out of scope: read/write/edit/apply_patch native wrappers stay unwired (FR-A4).
```

## Out of Scope

- **Wiring the `read`/`write`/`edit`/`apply_patch` native wrappers** — they exist in
  `packages/core/src/tool/native/` but are unwired at their tool entry points; flipping
  their default without wiring them (and their own parity gates) is deferred to a
  follow-up feature (ADR-0023 residual).
- **Embedding the dylib inside the compiled binary** — `dlopen` needs a real on-disk
  path; a `/$bunfs/root` asset is not `dlopen`-able. The dylib ships co-located on
  disk.
- **Cross-platform dylib shipping** — only the current-platform target is
  co-located; cross-compiled targets take the TS fallback until built on their host.
- **Changing the native execution path, parity, catalog version, dispatch path, or
  public payloads** — unchanged; only default selection + discovery/shipping change.
- **A schema-level default of `true`** — rejected in favor of the gate-level
  `!== false` operator (ADR-0023, Option B).

## Related Features and Decisions

- [ADR-0023 — Make native tools the default always and make them actually load from the compiled binary](../../adr/0023-make-native-tools-the-default-always-and-make-them-actually.md)
- [ADR-0010 — Native Rust FFI layer for built-in tools and PTY](../../adr/0010-add-native-rust-ffi-layer-for-built-in-tools-and-pty.md) — the loader, flags, parity/fallback seam this feature flips the default of and re-discovers.
- [Feature 010 — Add native Rust FFI layer](../010-add-native-rust-ffi-layer-for-built-in-tools-and-pty/spec.md)
- [ADR-0022 — Restore the production compiled build](../../adr/0022-restore-the-production-compiled-build-the-lazy-live-module.md) — the `bun build --compile` seam this feature ships the dylib through.
- [ADR-0001 — OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md) — the bounded-label discipline the diagnostic honors.

## Clarifications

### Session 2026-07-20

- **Native is the default via `!== false`, not a schema default (FR-A1, ADR-0023
  Option A).** The three wired gates (`glob`/`grep`/`bash`) flip from `=== true` to
  `!== false`, so absent ⇒ on and explicit `false` ⇒ off. A schema-level default was
  rejected as more invasive (Option B). Recorded in ADR-0023.
- **The compiled binary could never load native, independent of the flag (FR-B).**
  The bundled rung resolves from `import.meta.dir` = `/$bunfs/root` in a compiled
  binary (dead), and the compile shipped no dylib. The fix anchors a new discovery
  rung on `process.execPath` and ships the dylib co-located in `dist/`. Proven by a
  compiled binary reporting `importMetaDir=/$bunfs/root`, `rung=exec_colocated`,
  `loaded=true`. Recorded in ADR-0023.
- **The build fails loudly rather than shipping native-less (FR-B2).** A
  current-platform build with no producible dylibs exits non-zero with a clear message
  — the "recommended but unavailable" gap cannot recur silently. Recorded in ADR-0023.
- **The unwired wrappers stay out of scope (FR-A4).**
  `read`/`write`/`edit`/`apply_patch` native wrappers are not wired by this feature;
  wiring them is a documented follow-up. Recorded in ADR-0023.
- **Fallback, opt-out, win32, and permission-first are preserved (FR-A3).** Native is
  returned only on `outcome.kind === "ok"`; gaps fall back silently; explicit `false`
  disables; win32 never `dlopen`s; the `bash pty` permission gate still runs before
  any spawn. Recorded in ADR-0023.
</content>
</invoke>
