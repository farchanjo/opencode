# Tasks: Restore The Production Compiled Build By Loading The Lazy Live Modules Via Dynamic Import (Feature 022)

Synced with plan.md (Phase A dynamic-import conversion, Phase B async propagation,
Phase C preserve exactly-once/fail-open/eager-arm, Phase D regression guard +
compile/test/typecheck proof) and the specScopeGlobs in doc/arch/speckit.toml.
ADR-0022 accepted.

Module-load-mechanism correctness change ONLY. NO public payload change, NO command
id, NO catalog version bump, NO new dispatch path, NO new flag — and NO change to
the deferred-arming design beyond swapping a synchronous `require("./x-live")` for a
dynamic `await import("./x-live")` (FR-A). The pure composition modules still never
dereference the Bun global / `AppRuntime` at import, the singletons still arm
eagerly only at `server.listen()` (or lazily for CLI `op`), and fail-open +
exactly-once are preserved (FR-C). The hard gate is the COMPILE.

## Task Breakdown

Checkbox backlog (details under each group below). Phase A (the dynamic-import
conversion) is FIRST — everything else depends on the compile-safe seams.

- [x] T001 — Convert `telemetry-export.ts:loadLiveDeps` to `await import("./telemetry-export-live")`
- [x] T002 — Convert `executor-composition.ts:loadLiveDeps` to `await import("./executor-composition-live")`; make the accessor async
- [x] T003 — Propagate async to the two production call sites (`server.ts`, `stack-live.ts:jobsRunNow`)
- [x] T004 — FR-C: add the `pending` in-flight dedupe guard; preserve fail-open + eager-arm; update test call sites
- [x] T005 — FR-D: compiled-build regression guard (no `require("./*-live")` remains)
- [x] T006 — Prove the compile: `bun run build --single` exits 0 + binary emitted
- [x] T007 — Affected unit suites green (routing, jobs, operator) + `tsc --noEmit` no new errors
- [x] T008 — `speckit validate --json` green + doc sync

---

## Phase A — Compile-safe dynamic import for the TLA-reaching live seams (FR-A) — FIRST

- [x] **T001 — Convert `telemetry-export.ts:loadLiveDeps` to a dynamic import**
- **Depends:** none
- **Paths:** `packages/opencode/src/routing/telemetry-export.ts`
- **Deliverable:** replace `const live = require("./telemetry-export-live") as
  typeof import("./telemetry-export-live")` (`:305`) with `const live = await
  import("./telemetry-export-live")`; make `loadLiveDeps` `async`. It was already
  `Promise`-returning and consumed by the already-async `ensureTelemetryExport`, so
  no caller changes. Preserve the deferral — importing the module must still never
  dereference the Bun global / `AppRuntime`.
- **Acceptance:** `bun build --compile` no longer rejects this site; the telemetry
  export unit suite stays green; the module import arms no singleton.
- **Verification:** `bun test packages/opencode/test/routing/telemetry-export.test.ts`.
- **Evidence:** 2026-07-20 — `telemetry-export.ts:308-311` `async function
  loadLiveDeps()` now `const live = await import("./telemetry-export-live")`; the
  compile-rejected `require()` is gone. `ensureTelemetryExport` unchanged (already
  async). `telemetry-export.test.ts` green within routing suite (331 pass/1 skip).

- [x] **T002 — Convert `executor-composition.ts:loadLiveDeps`; make the accessor async**
- **Depends:** none
- **Paths:** `packages/opencode/src/jobs/executor-composition.ts`
- **Deliverable:** replace `const live = require("./executor-composition-live") as
  typeof import("./executor-composition-live")` (`:534`) with `const live = await
  import("./executor-composition-live")`; make `loadLiveDeps` `async` (now
  `Promise<ExecutorCompositionDeps>`) and `ensureExecutorComposition`
  `Promise`-returning. Leave the `bun-cron-adapter` `require()`
  (`executor-composition-live.ts:446`) unchanged — it does not reach a top-level
  await and the compiler accepts it.
- **Acceptance:** `bun build --compile` no longer rejects this site; the
  `bun-cron-adapter` `require()` compiles as-is.
- **Verification:** `bun test packages/opencode/test/jobs/executor-composition.test.ts`.
- **Evidence:** 2026-07-20 — `executor-composition.ts:544-548` `async function
  loadLiveDeps()` now `const live = await import("./executor-composition-live")`;
  `ensureExecutorComposition` (`:494-521`) returns `Promise<ExecutorComposition>`.
  `bun-cron-adapter` `require()` left in place — clean compile confirms it does not
  reach TLA.

## Phase B — Minimal, correct async propagation (FR-B)

- [x] **T003 — Propagate async to the two production call sites**
- **Depends:** T002
- **Paths:** `packages/opencode/src/server/server.ts`,
  `packages/opencode/src/operator/stack-live.ts`
- **Deliverable:** `server.ts:129` fire-and-forgets the now-async accessor: `void
  ExecutorComposition.ensureExecutorComposition().catch(() => {})` (arming still
  eager at `listen()`); `stack-live.ts:jobsRunNow` (`:423`) chains
  `ExecutorComposition.ensureExecutorComposition().then((composition) =>
  composition.enqueueImmediate({...}))` — the `RunNowEnqueuePort` already returns a
  `Promise`, so no contract widens. These are the ONLY two production callers.
- **Acceptance:** the server bootstrap and the operator run-now path both compile
  and behave identically (eager arm; run-now still degrades to
  `executor_unavailable` on a disarmed executor).
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-20 — `server.ts:132-138` `void
  ...ensureExecutorComposition().catch(() => {})`; `stack-live.ts:423-438`
  `jobsRunNow` awaits via `.then((composition) => composition.enqueueImmediate(...))`.
  Operator suite 491 pass/2 skip. No other production caller exists (grep).

## Phase C — Preserve exactly-once, fail-open, eager-arm (FR-C)

- [x] **T004 — Add the `pending` in-flight dedupe guard; preserve fail-open; update tests**
- **Depends:** T002
- **Paths:** `packages/opencode/src/jobs/executor-composition.ts`,
  `packages/opencode/test/jobs/executor-composition.test.ts`
- **Deliverable:** add `let pending: Promise<ExecutorComposition> | undefined`;
  `ensureExecutorComposition` returns `singleton` / `pending` / a `disarmed` when
  previously attempted, else sets `pending = armExecutorComposition(deps)`. The
  extracted `async armExecutorComposition` composes + arms once, clears `pending`,
  and on a fault degrades to `disarmed` (fail-open) — mirroring
  `ensureTelemetryExport`. `__resetExecutorCompositionForTests` clears `pending`.
  Update the three `ensureExecutorComposition(...)` test call sites to `await`.
- **Acceptance:** two concurrent `ensureExecutorComposition()` calls share one arm
  (no double-arm); a fault yields a `disarmed` composition; a second call reuses the
  instance; the server never crashes.
- **Verification:** `bun test packages/opencode/test/jobs/executor-composition.test.ts`.
- **Evidence:** 2026-07-20 — `executor-composition.ts:474` `let pending`;
  `ensureExecutorComposition` (`:494-501`) returns `singleton`/`pending`/`disarmed`
  else `pending = armExecutorComposition(deps)`; `armExecutorComposition`
  (`:509-527`) arms once, clears `pending`, fail-open `disarmed` on catch;
  `__resetExecutorCompositionForTests` (`:551`) clears `pending`. Three test call
  sites now `await` (idempotent T001, fail-open T002, disarmed-run-now T009). Jobs
  suite green.

## Phase D — Regression guard + compile/test/typecheck proof (FR-D, FR-all)

- [x] **T005 — Compiled-build regression guard**
- **Depends:** T001, T002
- **Paths:** `packages/opencode/test/jobs/compile-safe-live-load.test.ts`
- **Deliverable:** a lightweight source-invariant guard asserting neither
  `src/routing/telemetry-export.ts` nor `src/jobs/executor-composition.ts` contains
  a synchronous `require("./*-live")` and that each uses `await import("./*-live")`,
  with a comment pointing to ADR-0022. It MUST NOT run `bun build --compile` (too
  heavy for the unit suite) and MUST NOT flag `bun-cron-adapter` (not a `*-live`
  seam; does not reach TLA).
- **Acceptance:** the guard passes at HEAD and fails if a `require("./*-live")` is
  reintroduced in either seam.
- **Verification:** `bun test packages/opencode/test/jobs/compile-safe-live-load.test.ts`.
- **Evidence:** 2026-07-20 — `compile-safe-live-load.test.ts` reads both seam
  sources, asserts no `require(/\.\/[\w.-]*-live/)` and a matching `await
  import("./*-live")`; 2 pass. `bun-cron-adapter` not covered (documented in the
  test header).

- [x] **T006 — Prove the compile (the hard gate)**
- **Depends:** T003, T004
- **Paths:** `packages/opencode` (build script; no source change)
- **Deliverable:** run `cd packages/opencode && bun run build --single`; it MUST
  exit 0, emit `dist/opencode-darwin-arm64/bin/opencode`, and pass the `--version`
  smoke test — no `require call is not allowed ... top-level await` error.
- **Acceptance:** exit 0 + binary present + smoke test passes.
- **Verification:** `cd packages/opencode && bun run build --single`.
- **Evidence:** 2026-07-20 — `bun run build --single` exits 0; `building
  opencode-darwin-arm64` → "Smoke test passed:
  0.0.0-022-...-202607200957"; `dist/opencode-darwin-arm64/bin/opencode` present,
  132M (`ls -lh`). The two former `require()`-TLA errors are gone; no new
  require()-TLA site surfaced.

- [x] **T007 — Affected unit suites green + typecheck no new errors**
- **Depends:** T005, T006
- **Paths:** `packages/opencode/test/{routing,jobs,operator}/**`
- **Deliverable:** run the affected unit suites and `bunx tsc --noEmit`; report
  counts and confirm no new typecheck error beyond the known pre-existing set.
- **Acceptance:** routing/jobs/operator green; `tsc` adds no new error.
- **Verification:** `bun test test/routing test/jobs test/operator`; `bunx tsc --noEmit`.
- **Evidence:** 2026-07-20 — routing+jobs 331 pass/1 skip/0 fail (incl. the new
  guard); operator 491 pass/2 skip/0 fail; `bunx tsc --noEmit` → only the
  pre-existing `packages/tui/src/component/dialog-move-session.tsx` errors remain (0
  non-dialog errors), unchanged by this feature.

- [x] **T008 — `speckit validate --json` green + doc sync**
- **Depends:** T007
- **Paths:** `doc/arch/**`, `AGENTS.md`, `README.md`
- **Deliverable:** confirm every write stayed inside scope
  (`packages/opencode/src/{routing,jobs,operator,server/server.ts}`,
  `packages/opencode/test/{routing,jobs,operator}/**`, `doc/arch/**`); keep
  `AGENTS.md`/`README`/`doc/arch` in sync (no doc surface change expected —
  behavior/mechanism-correctness only); run `speckit validate --json` and resolve
  any finding this feature introduced.
- **Acceptance:** guard clean; `speckit validate --json` → `ok:true`; docs in sync.
- **Verification:** `speckit validate --json`.
- **Evidence:** 2026-07-20 — `speckit validate --json` → `ok:true` (only the
  pre-existing waived hygiene findings, none from this feature); `speckit status`
  updated. All writes inside scope; no doc surface change needed.

## Dependencies

- **Phase A before all.** T001/T002 make the seams compile-safe; T003 (call-site
  propagation) and T004 (the `pending` guard) depend on T002; the guard (T005) and
  the compile proof (T006) depend on the conversions; T007 depends on T005/T006;
  T008 gates the commit.
- **No external dependency.** No new SDK call, server change, or provider
  connection; `core/global.ts` is untouched. Tests use the existing routing/jobs/
  operator test stacks.
- **Invariant:** no task converts a non-TLA `require()`, adds an eager static
  top-level import, arms a singleton at import time, or changes any public payload,
  command id, catalog version, dispatch path, or feature flag (FR-A, FR-C, NFR).
