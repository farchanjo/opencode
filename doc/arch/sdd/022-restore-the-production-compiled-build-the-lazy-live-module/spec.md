---
id: 019f7ef0-f193-7663-990f-7c480efc9cc9
number: 022
slug: restore-the-production-compiled-build-the-lazy-live-module
status: implemented
created_at: 2026-07-20T09:52:27.539815Z
---
# Feature Specification: Restore The Production Compiled Build By Loading The Lazy Live Modules Via Dynamic Import

Feature: 022-restore-the-production-compiled-build-the-lazy-live-module
Created: 2026-07-20
Scope: The production compiled build is broken. `cd packages/opencode && bun run
build --single` (which drives `bun build --compile` to emit the single-file
`dist/opencode-darwin-arm64/bin/opencode`) **fails to compile** because two lazy
live-module seams load their `*-live` dependency with a **synchronous
`require(...)`** of a module whose transitive import graph contains a **top-level
`await`** (`@opencode-ai/core/global`, `packages/core/src/global.ts:35`). `bun
build --compile` forbids a `require()` of a TLA-bearing module — the whole binary
fails to emit, so there is no production artifact. This feature restores the
compiled build by converting each **compile-rejected** synchronous
`require("./x-live")` to a **dynamic `await import("./x-live")`** (which the
compiler permits for a TLA module), propagating `async` minimally and correctly to
the enclosing accessors and their call sites, and **preserving** the deliberate
017/018/019 deferred-arming design — the live seams stay lazy, the process
singletons still arm eagerly only at `server.listen()` (or lazily for CLI `op`),
and importing the pure composition modules still never dereferences the Bun global
or the `AppRuntime`. Behavior is identical except module-load timing (a dynamic
`import()` resolves one microtask later than a synchronous `require()`). No public
payload, command id, catalog version, dispatch path, server/port surface, or
feature flag changes.

## Audit result (grounding — every anchor verified 2026-07-20)

An enumeration of every `require(...)` in `packages/opencode/src` establishes
exactly which sites are compile hazards and which are not, so this spec converts
neither more nor less than the compiler rejects:

- **Site 1 (hazard — convert).** `routing/telemetry-export.ts:305`
  `const live = require("./telemetry-export-live") as typeof import("./telemetry-export-live")`.
  `telemetry-export-live` imports `@opencode-ai/core/global`
  (`telemetry-export-live.ts:30`), whose body runs a top-level `await
  Promise.all([...])` (`core/global.ts:35`). **Rejected by the compiler.**
- **Site 2 (hazard — convert).** `jobs/executor-composition.ts:534`
  `const live = require("./executor-composition-live") as typeof import("./executor-composition-live")`.
  `executor-composition-live` imports `@/config/config`
  (`executor-composition-live.ts:40`) → `@opencode-ai/core/global` (`config.ts:8`)
  → the same top-level `await`. **Rejected by the compiler.**
- **Site 3 (NOT a hazard — leave).** `jobs/executor-composition-live.ts:446`
  `require("./bun-cron-adapter")`. `bun-cron-adapter` imports only `effect`,
  `@opencode-ai/core/jobs/cron`, and `@opencode-ai/protocol/jobs/*` types — it does
  **not** transitively reach a top-level await, and the compiler **accepts** it (a
  clean compile with this `require()` in place confirms it empirically).
- **Sites 4-N (NOT hazards — leave).** `operator/adapters/outbound/otel-live.ts:37`
  `require("@opentelemetry/api")` (external optional peer, wrapped in try/catch for
  optionality), `cli/ui.ts:107` `require("readline")` (Node builtin),
  `operator/adapters/outbound/keychain-darwin.ts:59,195,214` `require("bun:ffi")`
  (Bun builtin), `operator/outputspool/backend-live.ts:303` (a runtime spool ref),
  and `tool/skill.ts:24` (tool-plugin `.require` API). None is a local module whose
  transitive graph reaches a top-level await; the compiler accepts them all.

**Conclusion.** Only the two `*-live` seams that transitively reach
`core/global`'s top-level await are compile hazards; converting them is **necessary
and sufficient**. This spec claims no wider defect and re-arms no singleton at
import time.

## Problem

The production binary cannot be built. The lazy live-module deferral introduced by
Features 017/018/019 chose a **synchronous `require()`** as its deferral mechanism.
The intent — never dereference the Bun global / `AppRuntime` at import, so the pure
cores stay importable under a non-Bun test runner and the singletons arm only at
server start — is correct and must be preserved. But `require()` is a *synchronous*
resolution, and `bun build --compile` forbids a synchronous `require()` of any
module whose transitive import graph contains a top-level `await`. Both live seams
transitively import `@opencode-ai/core/global` (directly, or via `@/config/config`),
whose module body runs `await Promise.all([...])`. So the compile aborts and no
`dist/opencode-darwin-arm64/bin/opencode` is emitted. The fix must swap only the
**mechanism** (synchronous `require` → dynamic `import`), not the **intent**
(deferred, lazy, arm-at-listen).

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — The production binary compiles again

- As a release engineer, I want `cd packages/opencode && bun run build --single`
  to exit 0 and emit `dist/opencode-darwin-arm64/bin/opencode` so that a
  production single-file binary can be shipped — the compile is the hard gate.

### P1 — The deferred-arming design is preserved, not eagerly armed

- As a maintainer, I want the fix to keep the live seams **lazy** — importing the
  pure composition module must still never dereference the Bun global or the
  `AppRuntime`, and the process singletons must still arm only at
  `server.listen()` (or lazily for CLI `op`) — so that the 017/018/019
  deferred-arming design and the non-Bun test-runner importability are intact.

### P1 — Async propagation is minimal and correct

- As a maintainer, I want each converted loader's `async` to propagate correctly
  and minimally to its accessor and call sites — no dropped promise, no lost
  fail-open, no double-arm across the new async boundary — so that behavior is
  identical except module-load timing.

### P2 — The compiled-build regression is locked

- As a maintainer, I want a regression guard that fails fast if a future edit
  reintroduces a synchronous `require("./*-live")` of a TLA-bearing seam, so that
  the compiled build cannot silently break the same way again.

## Functional Requirements

### Group A — Compile-safe dynamic import for the TLA-reaching live seams (FR-A)

1. **FR-A — Each compile-rejected `require("./x-live")` becomes a dynamic
   `await import("./x-live")`.** `routing/telemetry-export.ts:loadLiveDeps`
   (`:305`) and `jobs/executor-composition.ts:loadLiveDeps` (`:534`) MUST load
   their `*-live` module via `await import("./x-live")` instead of a synchronous
   `require("./x-live")`, so `bun build --compile` accepts the seam (a dynamic
   import of a TLA module is evaluated asynchronously, as TLA requires). Both
   loaders MUST be `async`. The conversion MUST NOT become an eager static
   top-level import (which would arm the singleton and dereference the Bun global /
   `AppRuntime` at import). The `bun-cron-adapter` `require()`
   (`executor-composition-live.ts:446`) and every other non-TLA `require()`
   enumerated in the audit MUST be left unchanged — only sites the compiler rejects
   are converted.

### Group B — Minimal, correct async propagation (FR-B)

2. **FR-B — The `async` ripples to EXACTLY the 2 production call sites, verified by
   grep.** `telemetry-export`'s `loadLiveDeps` was already `Promise`-returning and
   consumed by the already-async `ensureTelemetryExport`; 0 caller changes.
   `executor-composition`'s `ensureExecutorComposition` MUST become
   `Promise`-returning, and its exactly 2 production call sites (a `grep` for
   `ensureExecutorComposition` over `packages/*/src` returns precisely these two)
   MUST be updated: `server.ts:129` fire-and-forgets it (`void
   ...ensureExecutorComposition().catch(() => {})`, arming still eager at
   `listen()`), and the operator run-now port (`stack-live.ts:jobsRunNow`) MUST
   chain `.then((composition) => composition.enqueueImmediate({...}))` — its
   `RunNowEnqueuePort` already returns a `Promise`, so no contract widens. No other
   call site of either accessor exists in production (`server.ts` and
   `stack-live.ts` are the only ones); the test call sites are updated to `await`.

### Group C — Preserve exactly-once, fail-open, eager-arm (FR-C, guard/non-goal)

3. **FR-C — Idempotency, fail-open, and eager-arm-at-listen are PRESERVED.** The
   sync `ensureExecutorComposition` got exactly-once for free (no yield); the async
   version MUST add a `pending: Promise<ExecutorComposition> | undefined` in-flight
   guard (mirroring `ensureTelemetryExport`) so two concurrent callers before the
   singleton resolves share ONE arming and never double-arm nor return a `disarmed`
   while an arm is in flight; `__resetExecutorCompositionForTests` MUST clear
   `pending`. A construction/arming fault MUST still degrade to a `disarmed`
   composition/pipeline (the server still starts); the arm MUST still fire eagerly
   from `server.listen()` (one microtask later). It is an explicit **non-goal** to
   change any behavior other than module-load timing — no new eager coupling, no
   removed fail-open, no altered singleton lifecycle.

### Group D — Compiled-build regression guard (FR-D)

4. **FR-D — A regression guard locks the compile-safe load.** A lightweight unit
   guard MUST assert that neither `routing/telemetry-export.ts` nor
   `jobs/executor-composition.ts` contains a synchronous `require("./*-live")` and
   that each uses `await import("./*-live")`, with a comment pointing to this
   feature (ADR-0022). The guard MUST NOT itself run `bun build --compile` (too
   heavy for the unit suite); the compile remains the hard gate exercised by the
   build script. The `bun-cron-adapter` `require()` MUST NOT be flagged by the
   guard (it is not a `*-live` seam and does not reach a top-level await).

## Non-Functional Requirements

- **Preserve intent, change only mechanism.** The deferral is unchanged — the
  live seam is still fetched only on first arm; only the fetch mechanism (dynamic
  `import` vs synchronous `require`) changes.
- **No contract, catalog, or dispatch change.** No public payload, command id,
  catalog version, dispatch path, server/port surface, or feature flag is added or
  altered; this is a module-load-mechanism correctness change plus a regression
  guard.
- **No new eager coupling.** No path dereferences the Bun global or the
  `AppRuntime` at module import time; the pure composition modules stay importable
  under a non-Bun test runner.
- **Minimal blast radius.** Only the two hazard seams and their direct call sites
  change; `core/global.ts` is untouched (its top-level await is a foundational
  contract, out of scope to unwind).

## Acceptance Scenarios

Given the opencode workspace at HEAD on branch 022

- **The compiled binary builds (FR-A, P1).**
  Given the two lazy live seams load via `await import(...)`,
  When `cd packages/opencode && bun run build --single` runs,
  Then it exits 0, emits `dist/opencode-darwin-arm64/bin/opencode`, and the
  `--version` smoke test passes — no `require call is not allowed ... top-level
  await` error.

- **The pure composition module stays importable without the Bun runtime (FR-A,
  FR-C).**
  Given a non-Bun test runner that imports `telemetry-export.ts` /
  `executor-composition.ts` and injects fake deps,
  When the module is imported,
  Then it does not dereference the Bun global or the `AppRuntime`, and the
  singleton is NOT armed until `ensure*` is called.

- **Arming stays eager at listen, fail-open (FR-B, FR-C).**
  Given the server starts,
  When `server.listen()` fire-and-forgets `ensureExecutorComposition()` /
  `ensureTelemetryExport()`,
  Then the singletons arm (one microtask later), a construction/arming fault
  degrades to `disarmed` without breaking startup, and a second `ensure*` reuses
  the same instance (exactly-once).

- **Concurrent ensure de-dupes (FR-C).**
  Given two concurrent `ensureExecutorComposition()` calls before the first arm
  resolves,
  When both run,
  Then they share ONE in-flight `pending` arming and return the same composition —
  never a double-arm, never a `disarmed` returned while an arm is in flight.

- **Run-now chains through the resolved composition (FR-B).**
  Given the operator run-now port dispatches,
  When `jobsRunNow` runs,
  Then it awaits `ensureExecutorComposition()` and calls `enqueueImmediate({...})`
  on the resolved composition; a disarmed executor still degrades run-now to a
  typed `executor_unavailable` (fail-open unchanged).

- **The regression guard catches a reintroduced sync require (FR-D).**
  Given a future edit reintroduces `require("./telemetry-export-live")` or
  `require("./executor-composition-live")`,
  When the guard test runs,
  Then it fails — the compiled build cannot silently regress.

## Security Requirements

- **Data sensitivity/classification.** Not applicable — this feature changes only
  the module-load **mechanism** (synchronous `require` → dynamic `import`) for two
  internal lazy seams. It reads, writes, and exposes no data; the loaded modules
  and their behavior are unchanged.
- **Authentication/authorization.** Not applicable — no authenticated surface,
  credential, or permission boundary is introduced or altered. The seams load the
  same code through the same accessors; who may arm or dispatch is unchanged.
- **Input validation.** Not applicable — no new untrusted input is parsed. The
  dynamic `import(...)` specifiers are static string literals (`"./telemetry-
  export-live"`, `"./executor-composition-live"`), never a user- or config-derived
  path, so no dynamic-import path-injection surface is introduced.
- **Cryptography in transit/at rest.** Not applicable — this feature moves no data
  across a boundary and persists nothing; it changes only how two local modules are
  fetched at first-arm.
- **Logging/audit.** No new logging or audit surface. The live seams emit the same
  telemetry/audit they did before; only their load timing changes.
- **Error-handling information exposure.** Preserved and unchanged — a
  construction/arming fault is still caught and degraded to a `disarmed`
  composition/pipeline with the existing bounded, secret-free reason
  (`boundedReason`, never a raw stack trace); the dynamic import throwing is caught
  by the same fail-open path as the former `require()` throwing.

## Observability

This is a module-load-mechanism correctness change with no new backend surface, so
it emits no new metrics, log events, or trace spans. The telemetry export pipeline
and the executor composition continue to project the same Feature 001/018/019
telemetry through the existing ADR-0001 OTLP foundation with content-free, bounded
labels — unchanged, because the loaded modules and their behavior are unchanged;
only their fetch mechanism differs. Conventions live in
`doc/arch/observability/observability.md`.

## Domain Model

The compile-safe lazy-load contract and its guarantees are specified in
`doc/arch/schemas/restore-the-production-compiled-build-the-lazy-live-module.cue`:

```
require("./x-live")     --bun build --compile-->  REJECTED when x-live reaches TLA  (the break)
await import("./x-live") --bun build --compile-->  ACCEPTED (async eval of TLA)      (FR-A)

telemetry-export.loadLiveDeps  : already async; ensureTelemetryExport already async  (FR-B)
executor-composition.loadLiveDeps : now async; ensureExecutorComposition now async   (FR-B)
    server.ts               : void ensure...().catch(()=>{})   (eager arm at listen)  (FR-B)
    stack-live.jobsRunNow   : ensure...().then(c => c.enqueueImmediate({...}))        (FR-B)

exactly-once : pending in-flight guard dedupes concurrent ensure (no double-arm)      (FR-C)
fail-open    : construction/arming fault => disarmed; server still starts (unchanged) (FR-C)
eager-arm    : singleton arms at server.listen(), one microtask later (unchanged)     (FR-C)
lazy-import  : pure module import never dereferences Bun global / AppRuntime           (FR-C)

guard : no require("./*-live") in routing/jobs; each uses await import("./*-live")     (FR-D)
    bun-cron-adapter require() left as-is (does NOT reach TLA; compiler accepts it)     (FR-A)

No public payload, command id, catalog version, dispatch path, or feature flag
changes; core/global.ts top-level await is untouched (out of scope to unwind).
```

## Out of Scope

- **Removing or unwinding the top-level `await` in `core/global.ts`** — a
  foundational workspace initialization contract; unwinding it is a large,
  high-blast-radius refactor this build-fix does not warrant.
- **Converting non-hazard `require()` sites** — `bun-cron-adapter`,
  `@opentelemetry/api`, `readline`, `bun:ffi`, and the spool/plugin refs do not
  reach a top-level await and the compiler accepts them; they stay as-is.
- **Eager static top-level imports of the `*-live` modules** — rejected as it would
  arm the singletons at import and re-couple the pure cores to the Bun runtime.
- **Any operator payload, command id, catalog version, dispatch path, or feature
  flag change** — the contracts are untouched.
- **Running `bun build --compile` inside the unit suite** — too heavy; the source
  guard covers the invariant and the build script remains the hard gate.

## Related Features and Decisions

- [ADR-0022 — Restore the production compiled build by loading the lazy live modules via dynamic import](../../adr/0022-restore-the-production-compiled-build-the-lazy-live-module.md)
- [ADR-0019 — Complete the semantic binding lifecycle and the remaining operator residuals](../../adr/0019-complete-the-semantic-binding-lifecycle-and-the-remaining.md) — the telemetry export process singleton + lazy live seam (`telemetry-export.ts`, `telemetry-export-live.ts`) this feature makes compile-safe.
- [ADR-0018 — Compose the scheduled-jobs executor runtime into the live stack](../../adr/0018-compose-the-scheduled-jobs-executor-runtime-into-the-live.md) — the executor composition process singleton + eager arm at `listen()` (`executor-composition.ts`) this feature makes compile-safe.
- [Feature 017 — Close the implementable operator capability gaps](../017-close-the-implementable-operator-capability-gaps-so-the/spec.md) — the `ensureProcessSpoolWriter` process-singleton eager-seam precedent the two seams mirror.
- [ADR-0001 — OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md) — the OTLP export the telemetry seam wires onto.
- [Domain schema](../../schemas/restore-the-production-compiled-build-the-lazy-live-module.cue)

## Clarifications

### Session 2026-07-20

- **The root cause is the load mechanism, not the deferral (FR-A).** The lazy
  seams correctly defer arming, but chose a synchronous `require()` — which `bun
  build --compile` forbids over a module whose transitive graph reaches a top-level
  await (`core/global.ts:35`). The fix swaps the mechanism (dynamic `import`), not
  the intent. Recorded in ADR-0022.
- **Only two sites are compile hazards (FR-A, audit).** An enumeration of every
  `require()` in `packages/opencode/src` found only `telemetry-export.ts:305` and
  `executor-composition.ts:534` transitively reach the top-level await;
  `bun-cron-adapter` and the external/builtin requires do not, and the compiler
  accepts them (empirically, a clean compile with them in place). Recorded in
  ADR-0022.
- **The async ripple is minimal and traced (FR-B).** `ensureTelemetryExport` was
  already async (no caller change); `ensureExecutorComposition` becomes async and
  its only two production callers (`server.ts` fire-and-forget, `stack-live.ts`
  run-now `.then`) are updated correctly. Recorded in ADR-0022.
- **Exactly-once is preserved with a `pending` guard (FR-C).** The sync accessor
  got exactly-once for free; the async one adds a `pending` in-flight promise
  mirroring `ensureTelemetryExport`, so concurrent callers never double-arm.
  Recorded in ADR-0022.
- **Alternatives rejected (ADR-0022).** Unwinding `core/global.ts`'s top-level
  await (too broad), eager static top-level imports (would arm at import), and
  externalizing the live modules (breaks the self-contained binary) were all
  rejected in favor of the minimal dynamic-import conversion plus a source guard.
