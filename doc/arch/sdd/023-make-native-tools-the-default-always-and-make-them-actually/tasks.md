# Tasks: Make Native Tools The Default Always And Make Them Actually Load From The Compiled Binary (Feature 023)

Synced with plan.md (Phase A default-on gates, Phase B compiled-binary discovery +
dylib co-location, Phase C prove-it hard gates) and the specScopeGlobs in
doc/arch/speckit.toml. ADR-0023 accepted.

Default-selection + discovery/shipping change ONLY. NO change to the native execution
path, its parity guarantees, catalog version, dispatch path, or any public payload —
and NO wiring of the `read`/`write`/`edit`/`apply_patch` native wrappers (FR-A4,
documented follow-up). The escape hatch (explicit `native_tools=false` /
`native_pty=false`), the silent TS/ripgrep/ChildProcess fallback, the win32 disable,
and the `bash pty` permission-first ordering are all preserved (FR-A3). The DECISIVE
gate is that native ACTUALLY loads from a `bun build --compile` binary.

## Task Breakdown

- [x] T001 — FR-A1/A2: flip the three wired gates to `!== false` (default ON, explicit false opts out)
- [x] T002 — FR-A: document the default-ENABLED semantics in `experimental.ts`
- [x] T003 — FR-B1: add the `process.execPath`-anchored compiled-binary discovery rung
- [x] T004 — FR-B3: add `probeNativeStatus()` + `OPENCODE_NATIVE_DEBUG` content-free diagnostic
- [x] T005 — FR-B2: ship the built dylibs co-located into `dist/<name>/bin/native/<plat-arch>/`
- [x] T006 — Tests: default-on gate semantics, exec-rung discovery, probe, updated pty-bash default
- [x] T007 — Prove native loads from a real `bun build --compile` binary (DECISIVE)
- [x] T008 — Compile + build:native + core tool suite + `tsc --noEmit` + `speckit validate`

---

## Phase A — Native is the default, opt-out preserved (FR-A)

- [x] **T001 — Flip the three wired gates to `!== false`**
- **Depends:** none
- **Paths:** `packages/core/src/tool/glob.ts`, `packages/core/src/tool/grep.ts`,
  `packages/core/src/tool/bash.ts`
- **Deliverable:** change `native_tools === true` (glob:91, grep:116) and
  `native_pty === true` (bash:182) to `!== false`, so an absent flag defaults on and
  only an explicit `false` opts out. Native still returned only on
  `outcome.kind === "ok"`; gaps fall through the existing seam. Do NOT wire the four
  unwired wrappers (FR-A4).
- **Acceptance:** absent ⇒ native attempted; explicit false ⇒ TS/ripgrep/ChildProcess;
  explicit true unchanged; win32 + gaps still fall back.
- **Verification:** `cd packages/core && bun test test/tool/`.
- **Evidence:** 2026-07-20 — `glob.ts:92` and `grep.ts:117`
  `Config.latest(entries, "experimental")?.native_tools !== false`; `bash.ts:184`
  `?.native_pty !== false`. Comments updated to FR-A. Core tool suite 102 pass/0 fail.

- [x] **T002 — Document the default-ENABLED semantics in `experimental.ts`**
- **Depends:** T001
- **Paths:** `packages/core/src/config/experimental.ts`
- **Deliverable:** update the `native_tools` / `native_pty` JSDoc (`:23-31`) to state
  the fields default ENABLED (Feature 023), the gate reads `!== false`, only an explicit
  `false` disables, and the four wrappers stay unwired. Schema type unchanged (optional
  boolean).
- **Acceptance:** doc reflects default-on; no schema/behavior change from the doc edit.
- **Evidence:** 2026-07-20 — `experimental.ts:23-37` JSDoc rewritten: "default
  ENABLED (Feature 023 FR-A) … only an explicit `native_tools: false` disables … gates
  read this as `!== false` … read/write/edit/apply_patch stay unwired (ADR-0023)".

## Phase B — Native actually loads from a compiled binary (FR-B)

- [x] **T003 — Add the `process.execPath`-anchored compiled-binary discovery rung**
- **Depends:** none
- **Paths:** `packages/core/src/tool/native/loader.ts`
- **Deliverable:** add `execDir?: string` to `LoaderDeps`; in `discover()`, after the
  two env overrides and before the dev bundled rung, resolve
  `<execDir>/native/<platform>-<arch>/<stem>.<ext>` (`fileExists`-guarded, inert in
  dev). `defaultLoaderDeps()` sets `execDir = path.dirname(process.execPath)`. Keep
  rung1 (env), rung2 (`OPENCODE_NATIVE_LIB_DIR`), the dev bundled rung, and the typed
  gap; win32 still never `dlopen`s.
- **Acceptance:** the exec rung resolves a co-located dylib given a fake execDir; a dev
  checkout with no co-located dylib falls through to the bundled rung; env overrides
  still win.
- **Verification:** `cd packages/core && bun test test/tool/native/loader.test.ts`.
- **Evidence:** 2026-07-20 — `loader.ts:LoaderDeps.execDir`; `discover()` exec rung
  `path.join(deps.execDir, "native", "<plat-arch>", "<stem>.<ext>")` inserted between
  `OPENCODE_NATIVE_LIB_DIR` and the bundled rung; `defaultLoaderDeps().execDir =
  path.dirname(process.execPath)`. loader.test.ts +4 rung tests green.

- [x] **T004 — Add `probeNativeStatus()` + `OPENCODE_NATIVE_DEBUG` diagnostic**
- **Depends:** T003
- **Paths:** `packages/core/src/tool/native/loader.ts`
- **Deliverable:** `probeNativeStatus(crate?, deps?)` returns a content-free
  `NativeStatusReport` (`rung`, `path`, `loaded`, `gapReason`, `importMetaDir`,
  `execDir`, `semver`); `NativeLoader.load` emits one content-free stderr line per
  crate when `OPENCODE_NATIVE_DEBUG` is set. No file content / command string / session
  id is ever logged (Security, ADR-0001).
- **Acceptance:** probe reports `loaded:true` + `exec_colocated` when a dylib sits by
  the executable, `loaded:false` + `library_missing` when absent.
- **Verification:** `cd packages/core && bun test test/tool/native/loader.test.ts`.
- **Evidence:** 2026-07-20 — `loader.ts:probeNativeStatus` + `NativeStatusReport` +
  `classifyRung`; `NativeLoader.debugLog` gated on `env.OPENCODE_NATIVE_DEBUG`. 2 probe
  tests green. Used as the FR-B proof harness (T007).

- [x] **T005 — Ship the built dylibs co-located into `dist/`**
- **Depends:** T003
- **Paths:** `packages/opencode/script/build.ts`, `doc/arch/speckit.toml` (scope)
- **Deliverable:** after `rm -rf ./dist/<name>/bin/tui`, for the current-platform
  target copy `packages/core/native/<plat-arch>/*.{dylib,so}` into
  `dist/<name>/bin/native/<plat-arch>/`. If absent, run `bun run build:native`; if
  still absent, `process.exit(1)` with a clear message. Cross targets skip (TS
  fallback). Web-ui embed + tui removal intact. Add `packages/opencode/script/build.ts`
  to specScopeGlobs (the correct speckit scope adjustment, not a guard bypass).
- **Acceptance:** the dist output contains `dist/<name>/bin/native/<plat-arch>/
  libopencode_{tools,pty}_ffi.dylib`; a native-less current-platform build fails loudly.
- **Verification:** `cd packages/opencode && bun run build --single` then `ls
  dist/opencode-darwin-arm64/bin/native/darwin-arm64/`.
- **Evidence:** 2026-07-20 — `build.ts` co-location block added (current-platform
  guard, missing ⇒ `bun run build:native` ⇒ still-missing ⇒ `process.exit(1)`); build
  log: "Co-located native dylib: dist/opencode-darwin-arm64/bin/native/darwin-arm64/
  libopencode_tools_ffi.dylib" (+ pty). speckit.toml specScopeGlobs +=
  `packages/opencode/script/build.ts`.

## Phase C — Prove it (hard gates) (FR-A, FR-B)

- [x] **T006 — Tests: default-on gate semantics, exec-rung discovery, probe, pty-bash default**
- **Depends:** T001, T003, T004
- **Paths:** `packages/core/test/tool/native/config-flags.test.ts`,
  `packages/core/test/tool/native/loader.test.ts`,
  `packages/core/test/tool/native/pty-bash.test.ts`
- **Deliverable:** (a) config-flags: default-on gate semantics — absent ⇒ `!== false`
  true, explicit false ⇒ false, explicit true ⇒ true; (b) loader: `exec_colocated`
  rung resolves a co-located dylib with a fake execDir, inert-in-dev fallthrough,
  env-wins-over-exec, `probeNativeStatus` loaded/missing; (c) pty-bash: retire the
  obsolete "absent ⇒ off" test → tri-state config (undefined/false/true); explicit
  `native_pty:false` ⇒ ChildProcess, and a NEW default-on test (absent ⇒ native serves
  `printf pty-default-ok`).
- **Acceptance:** `cd packages/core && bun test test/tool/` green.
- **Verification:** `cd packages/core && bun test test/tool/`.
- **Evidence:** 2026-07-20 — config-flags.test.ts default-on describe (a/b/explicit-true);
  loader.test.ts +4 rung tests +2 probe tests; pty-bash.test.ts `nativePtySetting`
  tri-state, explicit-false opt-out test, new default-on native test. `bun test
  test/tool/` → 102 pass / 0 fail (the `panicked … 0xfeedface` line is the deliberate
  panic-containment probe, expected).

- [x] **T007 — Prove native loads from a real `bun build --compile` binary (DECISIVE)**
- **Depends:** T005
- **Paths:** proof harness (temporary, deleted after compiling; not committed)
- **Deliverable:** compile a probe with the SAME `bun build --compile`
  (`autoloadBunfig:false`) mechanism as opencode, place it in the deployed layout
  (`dist/opencode-darwin-arm64/bin/`) beside the co-located dylibs, run it with no env,
  and observe the loader resolves + `dlopen`s native. This proves the mechanism inside a
  genuine bunfs-compiled binary where `import.meta.dir` is `/$bunfs/root`.
- **Acceptance:** the compiled probe reports `importMetaDir=/$bunfs/root` (dev rung
  dead), `rung=exec_colocated`, `loaded=true` for both crates.
- **Verification:** run the compiled probe from `dist/opencode-darwin-arm64/bin/`.
- **Evidence:** 2026-07-20 — compiled probe (via `Bun.build` compile,
  `autoloadBunfig:false`, target `bun-darwin-arm64`) run from
  `dist/opencode-darwin-arm64/bin/` with no env →
  `tools`: `importMetaDir:"/$bunfs/root"`, `rung:"exec_colocated"`,
  `path:".../dist/opencode-darwin-arm64/bin/native/darwin-arm64/
  libopencode_tools_ffi.dylib"`, `loaded:true`, `semver:"0.1.0"`; `pty` identical
  (`libopencode_pty_ffi.dylib`, `loaded:true`). Native ACTUALLY loads from the deployed
  compiled-binary layout. Probe source + binary removed after the run.

- [x] **T008 — Compile + build:native + suite + typecheck + validate**
- **Depends:** T006, T007
- **Paths:** `packages/core`, `packages/opencode`, `doc/arch/**`
- **Deliverable:** `bun run build:native` produces the dylibs; `cd packages/opencode &&
  bun run build --single` exits 0 with the co-located dylibs in dist; core tool suite
  green; `bunx tsc --noEmit` (core + opencode) no new errors; `speckit validate --json`
  ok:true (only the pre-existing/skeleton-resolved findings).
- **Acceptance:** compile exit 0 + dylibs shipped; suites green; no new tsc error;
  validate green.
- **Verification:** the commands above.
- **Evidence:** 2026-07-20 — `bun run build:native` →
  `packages/core/native/darwin-arm64/libopencode_{tools,pty}_ffi.dylib` (3.2M/750K).
  `bun run build --single` exit 0; smoke test "0.0.0-023-…-202607201018"; binary 132M +
  co-located native subdir present. `bun test test/tool/` 102 pass/0 fail. `bunx tsc
  --noEmit` core = exit 0; opencode = only the pre-existing
  `packages/tui/src/component/dialog-move-session.tsx` errors (unchanged, Feature 022
  baseline), 0 new. `speckit validate --json` → ok:true (skeleton placeholder findings
  resolved by authoring this corpus; only the 4 waived hygiene.empty-file remain).

## Dependencies

- **Phase A and Phase B are independent** and were implemented together; the tests
  (T006) and the compile/proof (T007/T008) depend on both.
- **No external dependency.** The dylibs are produced by `bun run build:native` (cargo,
  host platform); no network, SDK, or server change. win32 and cross-compiled targets
  take the TypeScript fallback by design.
- **Invariant:** no task wires the `read`/`write`/`edit`/`apply_patch` native wrappers
  (FR-A4), changes the native execution path/parity, bumps the catalog version, alters
  a dispatch path, or removes the silent fallback / opt-out / win32 disable /
  permission-first ordering (FR-A3).
</content>
</invoke>
