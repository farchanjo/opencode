---
status: accepted
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0023 — Make Native Tools The Default Always And Make Them Actually Load From The Compiled Binary

## Context and Problem Statement

Feature 010 introduced a native Rust FFI backend for the built-in tools and PTY
behind two experimental flags, `experimental.native_tools` and
`experimental.native_pty`. Two years of hardening later (parity suite, byte-identical
fallback suite, leak/panic stress suite, ABI handshake) the native path is proven,
but two facts keep it effectively dark in production:

1. **The flags are opt-in.** Both are optional booleans that default to `false` — an
   absent flag takes the TypeScript/ripgrep path. Only the three wired gates read
   them, each as `=== true` (`packages/core/src/tool/glob.ts:91`,
   `grep.ts:116`, `bash.ts:182`). A user who never sets the flag never gets native.

2. **The dylib is unreachable from a compiled binary.** The loader's discovery
   ladder (`packages/core/src/tool/native/loader.ts:discover`) resolves the bundled
   dylib from `defaultBundledBaseDir()` = `path.resolve(import.meta.dir,
   "../../../native")`. Inside a `bun build --compile` single-file binary,
   `import.meta.dir` is the virtual `/$bunfs/root` namespace, so that rung resolves
   to a path that does not exist on disk — the bundled rung is **dead** for the
   shipped artifact. Worse, the compile step (`packages/opencode/script/build.ts`,
   `Bun.build` compile) ships **no dylib at all**: the `packages/core/native/…`
   artifacts are gitignored build output that never enters `dist/`. So even with the
   flag forced on, a production binary finds no library and silently falls back.

The result: native tools are simultaneously "recommended" and "unavailable in
production." This feature makes native the **default** (unless explicitly disabled)
**and** makes it actually load from a compiled/deployed binary
(e.g. `/opt/opencodev2/opencode`).

**Scope guard.** Only `glob`, `grep`, and `bash pty:true` are wired to the flag
today; the `read`/`write`/`edit`/`apply_patch` native wrappers exist in
`packages/core/src/tool/native/` but are **not** wired into their tool entry points.
This feature does **not** wire them — it flips the default and fixes discovery for
the already-wired surface. Wiring the remaining wrappers is a documented follow-up.

## Decision Drivers

- **Native by default.** An absent flag MUST select native; the proven path should
  be the one users get without opting in.
- **Explicit opt-out preserved.** An explicit `native_tools: false` /
  `native_pty: false` MUST still fully disable native — the escape hatch stays.
- **Fallback never regresses.** Every `NativeUnavailable` gap (missing library,
  `dlopen` failure, ABI mismatch, win32) MUST still fall back silently to the
  TypeScript/ripgrep/ChildProcess path — no hard crash, win32 stays disabled.
- **Actually load from the shipped binary.** A compiled `opencode` MUST resolve and
  `dlopen` the co-located dylib at runtime; discovery MUST NOT depend on
  `import.meta.dir`, which is `/$bunfs/root` in a compiled binary.
- **Honest, decisive proof.** "Default" is meaningless unless the library actually
  loads — the change MUST be proven by running a compiled binary and observing the
  native path is taken, not merely by a unit assertion.
- **Minimal, centralized change.** Flip the default in one obvious place per gate;
  do not fork behavior across the three call sites.

## Considered Options

- **Option A — Read the gate as `!== false` (absent ⇒ on) + add a compiled-binary
  discovery rung resolved from `process.execPath`, and ship the co-located dylib in
  the build (chosen).** The three gates change from `=== true` to `!== false`, so an
  absent flag defaults on and an explicit `false` still disables. The loader gains a
  rung that resolves `<execDir>/native/<platform>-<arch>/<stem>.<ext>` from
  `path.dirname(process.execPath)` — the one location a compiled binary can resolve —
  guarded by `fileExists` so it is inert in a dev checkout. `build.ts` copies the
  built dylibs into `dist/<name>/bin/native/<platform>-<arch>/` for the current
  platform. Proven by a `bun build --compile` binary that reports `import.meta.dir =
  /$bunfs/root`, resolves via the `exec_colocated` rung, and `dlopen`s the library.
- **Option B — Give the schema fields a resolved default of `true`.** Rejected as
  more invasive and less local: the config resolver would have to inject a default
  the three gates already express in one operator (`!== false`), and a schema-level
  default risks changing how absence is serialized/migrated elsewhere. The gate-level
  `!== false` is the minimal, self-documenting change.
- **Option C — Embed the dylib inside the compiled binary (bunfs asset).** Rejected:
  `bun:ffi` `dlopen` needs a real on-disk path; a `/$bunfs/root` asset is not
  `dlopen`-able. A co-located on-disk dylib beside the executable is the portable,
  deployable layout (mirrors how the binary already ships sibling assets).
- **Option D — Point the bundled rung at `import.meta.dir` and "fix" it.** Rejected:
  `import.meta.dir` is fundamentally `/$bunfs/root` in a compiled binary; no amount of
  path arithmetic off it reaches the real filesystem. The executable location
  (`process.execPath`) is the only stable anchor.
- **Option E — Also wire `read`/`write`/`edit`/`apply_patch` native wrappers now.**
  Rejected for this feature: those wrappers are unwired and unproven at their tool
  entry points; flipping their default without wiring them would be a no-op at best
  and a parity risk at worst. Documented as an explicit follow-up.

## Decision Outcome

Chosen option: **Option A**, because it makes native the default with a single
self-documenting operator per gate, preserves the explicit opt-out and the silent
fallback verbatim, and — critically — makes the library actually load from a
compiled binary by anchoring discovery on `process.execPath` and shipping the dylib
co-located in `dist/`. The change is proven by running a real compiled binary.

Key decisions recorded:

1. **Default-on gates (FR-A).** `glob.ts`, `grep.ts`, and `bash.ts` read the flag as
   `Config.latest(entries, "experimental")?.native_tools !== false` (and
   `native_pty !== false` for bash). Absent ⇒ `undefined !== false` ⇒ native; explicit
   `false` ⇒ TS/ripgrep/ChildProcess; explicit `true` ⇒ native (unchanged). The
   schema fields stay optional booleans; the default lives in the gate operator.

2. **Compiled-binary discovery rung (FR-B).** `discover()` gains a rung, after the
   two env overrides and before the dev bundled rung, that resolves
   `<execDir>/native/<platform>-<arch>/<stem>.<ext>` from a new injectable
   `LoaderDeps.execDir` (= `path.dirname(process.execPath)` in
   `defaultLoaderDeps`). It is `fileExists`-guarded, so a dev checkout — where no
   dylib sits beside the Bun interpreter — falls through to the bundled rung
   unchanged. Env overrides (`OPENCODE_TOOLS_FFI_PATH` / `OPENCODE_PTY_FFI_PATH` /
   `OPENCODE_NATIVE_LIB_DIR`), the dev bundled rung, and the typed-gap fallback are
   all preserved; win32 still never `dlopen`s.

3. **Ship the dylib co-located (FR-B).** `packages/opencode/script/build.ts` copies
   the built `libopencode_tools_ffi` / `libopencode_pty_ffi` dylibs from
   `packages/core/native/<platform>-<arch>/` into
   `dist/<name>/bin/native/<platform>-<arch>/` for the current-platform target. If
   the dylibs are absent it triggers `bun run build:native`, and if they are still
   absent it fails loudly (exit 1) rather than silently shipping a native-less
   binary. Cross-compiled targets carry no host dylib and fall back to the TS path.
   The existing `rm -rf ./dist/<name>/bin/tui` and web-ui embed behavior is intact.

4. **Honest diagnostic (FR-B proof).** The loader gains `probeNativeStatus()` — a
   content-free report (`rung`, `path`, `loaded`, `gapReason`, `importMetaDir`,
   `execDir`, `semver`) — and an `OPENCODE_NATIVE_DEBUG` stderr line on the shared
   loader's first load. Neither logs file content, paths beyond the resolved dylib,
   command strings, or session ids.

5. **Preserve fallback + opt-out + win32 (FR-A, invariant).** Native is returned only
   on `outcome.kind === "ok"`; any gap falls through the existing seam. Explicit
   `false` fully disables; win32 is hard-disabled at the loader. No parity behavior,
   catalog version, dispatch path, or public payload changes.

### Consequences

- Good: native tools/PTY are the default — an unconfigured user gets the proven
  embedded ignore+globset/terminal engines, with the TS/ripgrep path as the silent
  safety net.
- Good: a compiled/deployed binary actually loads native — proven by a `bun build
  --compile` binary reporting `importMetaDir=/$bunfs/root`, resolving via the
  `exec_colocated` rung, and `dlopen`-ing both dylibs (`loaded:true`, `semver
  0.1.0`) from `dist/opencode-darwin-arm64/bin/native/darwin-arm64/`.
- Good: the release build fails loudly if it would otherwise ship a native-less
  current-platform binary — the "recommended but unavailable" gap cannot recur
  silently.
- Good: the escape hatch is preserved — `experimental.native_tools=false` /
  `native_pty=false` fully disables; win32 always takes the TS path.
- Neutral (documented boundary): cross-compiled targets (a Linux binary built on
  macOS, etc.) ship no dylib and take the TS fallback until built on their own host;
  the co-located rung only fires when a matching dylib is present.
- Bad (residual, documented follow-up): the `read`/`write`/`edit`/`apply_patch`
  native wrappers remain **unwired** at their tool entry points — this feature flips
  the default and fixes discovery for the already-wired `glob`/`grep`/`bash pty`
  surface only. Wiring the remaining four wrappers (with their own parity gates) is
  deferred to a follow-up feature.

## Related

- Feature specification: [023 Make native tools the default always and make them actually](../sdd/023-make-native-tools-the-default-always-and-make-them-actually/spec.md)
- Native FFI layer + loader + flags this feature flips and re-discovers: [ADR-0010 native Rust FFI layer](0010-add-native-rust-ffi-layer-for-built-in-tools-and-pty.md), [Feature 010](../sdd/010-add-native-rust-ffi-layer-for-built-in-tools-and-pty/spec.md)
- Compiled-build seam this feature ships the dylib through: [ADR-0022 Restore the production compiled build](0022-restore-the-production-compiled-build-the-lazy-live-module.md), [Feature 022](../sdd/022-restore-the-production-compiled-build-the-lazy-live-module/spec.md)
- OTLP telemetry foundation the native.* diagnostic labels honor: [ADR-0001 OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)
- FFI ABI / native schemas: [doc/arch/schemas/ffi](../schemas/ffi)
</content>
</invoke>
