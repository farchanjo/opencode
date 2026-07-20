# Implementation Plan: Make Native Tools The Default Always And Make Them Actually Load From The Compiled Binary

## Overview

Make the proven Feature 010 native Rust FFI backend the DEFAULT for the already-wired
tool surface, and make it ACTUALLY load from a compiled/deployed binary. Two parts,
each independently verifiable. Part A flips the three wired gates (`glob`/`grep`/
`bash pty`) from `=== true` to `!== false` so an absent flag defaults on and only an
explicit `false` opts out — preserving the silent TS/ripgrep fallback, the win32
disable, and the permission-first ordering. Part B fixes the reason a compiled binary
never loaded native: the bundled discovery rung resolves from `import.meta.dir` =
`/$bunfs/root` in a `bun build --compile` binary (dead), and the compile shipped no
dylib. It adds a discovery rung anchored on `process.execPath` and ships the built
dylibs co-located in `dist/<name>/bin/native/<platform>-<arch>/`. See the
specification for the full requirement set; ADR-0023 records the decision. The
`read`/`write`/`edit`/`apply_patch` native wrappers stay unwired (documented
follow-up, FR-A4).

## Technical Approach

Architectural layers affected: the three wired tool gates
(`packages/core/src/tool/{glob,grep,bash}.ts`), the native loader
(`packages/core/src/tool/native/loader.ts`), the experimental config schema doc
(`packages/core/src/config/experimental.ts`), and the compiled-build script
(`packages/opencode/script/build.ts`). The native execution path itself, its parity
guarantees, and every public payload are unchanged — only default selection and dylib
discovery/shipping change.

- **Phase A — Default-on gates (FR-A).** Change the three gates from
  `Config.latest(entries, "experimental")?.native_tools === true` to `!== false`
  (`native_pty !== false` for bash). Absent ⇒ `undefined !== false` ⇒ native; explicit
  `false` ⇒ TS/ripgrep/ChildProcess; explicit `true` ⇒ native. Native is still
  returned only on `outcome.kind === "ok"`; every gap falls through the existing seam;
  win32 stays disabled at the loader. Update the `experimental.ts` JSDoc to document
  the default-ENABLED semantics. Do NOT wire the four unwired wrappers.

- **Phase B — Compiled-binary discovery rung (FR-B1).** Add `execDir?: string` to
  `LoaderDeps` (injectable seam) and, in `discover()`, a rung after the two env
  overrides and before the dev bundled rung that resolves
  `<execDir>/native/<platform>-<arch>/<stem>.<ext>`, `fileExists`-guarded so it is
  inert in dev. `defaultLoaderDeps()` sets `execDir = path.dirname(process.execPath)`.
  Add `probeNativeStatus()` (content-free load report) and an `OPENCODE_NATIVE_DEBUG`
  stderr line on the shared loader's first load (FR-B3).

- **Phase B — Ship the dylib co-located (FR-B2).** In `build.ts`, after
  `rm -rf ./dist/<name>/bin/tui`, for the current-platform target copy
  `packages/core/native/<platform>-<arch>/*.{dylib,so}` into
  `dist/<name>/bin/native/<platform>-<arch>/`. If absent, trigger `bun run
  build:native`; if still absent, `process.exit(1)` with a clear message. Cross
  targets carry no host dylib and take the TS fallback. Keep the web-ui embed intact.

- **Phase C — Prove it (hard gates).** (1) `cd packages/core && bun test test/tool/`
  green, with new tests: default-on gate semantics (absent ⇒ native, explicit false ⇒
  TS), the `exec_colocated` discovery rung with a fake execDir, the inert-in-dev
  fallthrough, and `probeNativeStatus`. (2) `bun run build:native` produces the
  dylibs. (3) `cd packages/opencode && bun run build --single` exits 0 and the dist
  output contains the co-located dylibs. (4) DECISIVE: a `bun build --compile` binary
  placed in the deployed layout reports `importMetaDir=/$bunfs/root`,
  `rung=exec_colocated`, `loaded=true` — native actually loads. (5) `bunx tsc
  --noEmit` (core + opencode) no new errors; `speckit validate --json` ok:true.

Key integration points: the three tool gates read the flag via `Config.latest`; the
loader's `discover()` ladder and `defaultLoaderDeps()`; the build script's
per-target loop. The `LoaderDeps` seam keeps every discovery rung unit-testable with
fake deps (no real dylib needed for the rung tests).

## Companion Artifacts

No new companion files are required. The authoritative FFI/ABI contracts remain in
`doc/arch/schemas/ffi` (Feature 010); this feature changes default selection and
discovery/shipping, not the ABI or payloads. The domain model is captured inline in
the specification (`## Domain Model`).
</content>
</invoke>
