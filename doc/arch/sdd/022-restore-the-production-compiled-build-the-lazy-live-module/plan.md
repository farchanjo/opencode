# Implementation Plan: Restore The Production Compiled Build By Loading The Lazy Live Modules Via Dynamic Import

## Overview

Restore the production compiled build for feature
022-restore-the-production-compiled-build-the-lazy-live-module. `cd
packages/opencode && bun run build --single` fails because two lazy live-module
seams load their `*-live` dependency with a synchronous `require(...)` of a module
whose transitive import graph contains a top-level `await`
(`@opencode-ai/core/global`). `bun build --compile` forbids that. This plan
converts each compile-rejected `require("./x-live")` to a dynamic `await
import("./x-live")`, propagates `async` minimally and correctly to the accessors
and their call sites, preserves the 017/018/019 deferred-arming design verbatim
(FR-A, FR-B, FR-C), and locks the invariant with a lightweight source guard
(FR-D). See the specification for the full requirement set; ADR-0022 records the
decision.

## Technical Approach

Architectural layers affected: the routing telemetry-export process singleton, the
jobs executor-composition process singleton, and the two production call sites of
`ensureExecutorComposition` (server bootstrap + operator run-now port). The change
is a **module-load-mechanism** correctness fix — the loaded modules and their
runtime behavior are unchanged; only how they are fetched at first-arm changes.

- **Phase A — Convert the TLA-reaching lazy loaders to dynamic import (FR-A).**
  `routing/telemetry-export.ts:loadLiveDeps` and
  `jobs/executor-composition.ts:loadLiveDeps` load their `*-live` module via `await
  import("./x-live")` instead of `require("./x-live")`; both loaders are `async`.
  No eager static top-level import (that would arm at import). Every non-TLA
  `require()` (`bun-cron-adapter`, external/builtin) is left unchanged — the
  compiler accepts them.

- **Phase B — Propagate async minimally and correctly (FR-B).**
  `ensureTelemetryExport` was already async (no caller change).
  `ensureExecutorComposition` becomes `Promise`-returning; `server.ts`
  fire-and-forgets it (`void ...catch(() => {})`, eager arm at `listen()`), and
  `stack-live.ts:jobsRunNow` chains `.then((c) => c.enqueueImmediate({...}))` — its
  `RunNowEnqueuePort` already returns a `Promise`. The two test call sites are
  updated to `await`.

- **Phase C — Preserve exactly-once, fail-open, eager-arm (FR-C).** Add a
  `pending: Promise<ExecutorComposition> | undefined` in-flight guard to
  `ensureExecutorComposition` (mirroring `ensureTelemetryExport`) so concurrent
  callers dedupe and never double-arm; clear it in
  `__resetExecutorCompositionForTests`. Fail-open (`disarmed` on fault) and eager
  arm at `listen()` stay intact.

- **Phase D — Lock the regression + prove the compile (FR-D).** Add a lightweight
  unit guard asserting no synchronous `require("./*-live")` remains in
  `routing/telemetry-export.ts` / `jobs/executor-composition.ts` and each uses
  `await import("./*-live")`. Prove the hard gate: `bun run build --single` exits 0
  and emits `dist/opencode-darwin-arm64/bin/opencode`; run the affected unit suites
  green; `bunx tsc --noEmit` adds no new errors.

Key integration points: `server.ts` (eager bootstrap at `listen()`),
`stack-live.ts` (operator run-now port), and the existing process-singleton
lifecycle (`ensure*` / `current*` / `rearm*` / `__reset*ForTests`). `core/global.ts`
is untouched — its top-level `await` is a foundational contract, out of scope to
unwind.

## Companion Artifacts

This is a compile-safety fix, not a domain feature — no `research.md`,
`data-model.md`, `contracts/`, or `quickstart.md` companions are needed. The
authoritative compile-safe lazy-load ValueObject lives in
`doc/arch/schemas/restore-the-production-compiled-build-the-lazy-live-module.cue`;
behavioral requirements and FR-A–FR-D are only in [spec.md](spec.md) and
ADR-0022.
