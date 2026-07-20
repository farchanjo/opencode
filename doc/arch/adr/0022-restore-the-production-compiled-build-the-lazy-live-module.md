---
status: accepted
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0022 — Restore The Production Compiled Build By Loading The Lazy Live Modules Via Dynamic Import

## Context and Problem Statement

The production compiled build — `cd packages/opencode && bun run build --single`,
which drives `bun build --compile` to emit the single-file
`dist/opencode-darwin-arm64/bin/opencode` — was **broken**. Reproduced 2026-07-20
(every `file:line` verified), the compile aborted with, at two sites:

```
error: This require call is not allowed because the transitive dependency
"../core/src/global.ts" contains a top-level await
```

- `packages/opencode/src/routing/telemetry-export.ts:305` —
  `const live = require("./telemetry-export-live") as typeof import("./telemetry-export-live")`.
  `telemetry-export-live` imports `@opencode-ai/core/global`
  (`telemetry-export-live.ts:30`), whose module body runs a top-level
  `await Promise.all([...])` (`packages/core/src/global.ts:35`).
- `packages/opencode/src/jobs/executor-composition.ts:534` —
  `const live = require("./executor-composition-live") as typeof import("./executor-composition-live")`.
  `executor-composition-live` imports `@/config/config`
  (`executor-composition-live.ts:40`), which imports `@opencode-ai/core/global`
  (`config.ts:8`) — the same top-level `await`.

`bun build --compile` forbids a **synchronous** `require()` of any module whose
transitive import graph contains a top-level `await` (TLA): a `require()` must
resolve synchronously, but a TLA module can only be evaluated asynchronously.
This is a hard compiler rule, not a warning — the whole binary fails to emit, so
there is no production artifact.

**Why the `require()` was there.** Features 017/018/019 deliberately deferred the
live seams behind a *lazy* accessor so that importing the pure composition module
(`telemetry-export.ts` / `executor-composition.ts`) never dereferences the Bun
global or the `AppRuntime` — the cores stay importable under a non-Bun test runner
that injects fakes, and the process singletons arm only when the server actually
starts. `require()` was chosen as a *synchronous* deferral. That deferral intent
is correct and must be preserved; only the **mechanism** (`require`) is
incompatible with the compiler.

**Audit — the full require() surface (grounds this ADR's scope).** An enumeration
of every `require(...)` in `packages/opencode/src` established exactly which are
compile hazards and which are not:

| Site | Target | Reaches TLA? | Action |
|---|---|---|---|
| `routing/telemetry-export.ts:305` | `./telemetry-export-live` | ✅ `core/global` | **Convert** to `await import` |
| `jobs/executor-composition.ts:534` | `./executor-composition-live` | ✅ `config → core/global` | **Convert** to `await import` |
| `jobs/executor-composition-live.ts:446` | `./bun-cron-adapter` | ❌ (effect + protocol types only) | Leave — compiler accepts it |
| `operator/adapters/outbound/otel-live.ts:37` | `@opentelemetry/api` | ❌ (external optional peer) | Leave — not a local TLA module |
| `cli/ui.ts:107` | `readline` | ❌ (Node builtin) | Leave |
| `operator/adapters/outbound/keychain-darwin.ts:59,195,214` | `bun:ffi` | ❌ (Bun builtin) | Leave |
| `operator/outputspool/backend-live.ts:303` | dynamic ref (spool) | n/a runtime ref | Leave |
| `tool/skill.ts:24` | tool-plugin `.require` | n/a (plugin API) | Leave |

Only the two `*-live` seams that transitively reach `core/global`'s TLA are
compile hazards; converting them is necessary **and sufficient** — the empirical
compile confirms `bun-cron-adapter`'s `require()` is accepted because it does not
reach a top-level await.

The question: how to restore the compiled build **without** re-arming the process
singletons at import time (which would defeat the 017/018/019 deferred-arming
design and re-couple the pure cores to the Bun runtime), and **without** changing
any runtime behavior other than load timing.

## Decision Drivers

- **Restore the compiled binary.** `bun run build --single` MUST exit 0 and emit
  `dist/opencode-darwin-arm64/bin/opencode`; this is the hard gate.
- **Preserve deferred arming.** The live seams MUST stay lazy — importing the
  composition module must not dereference the Bun global / `AppRuntime`, and the
  singletons must arm only at `server.listen()` (or lazily for CLI `op`), never at
  module import. No conversion to an eager static top-level import.
- **Behavior-identical except load timing.** Fail-open, idempotent
  (exactly-once), and eager-arm-at-listen semantics stay intact; the only change is
  that the module is fetched by a dynamic `import()` (one microtask later) instead
  of a synchronous `require()`.
- **Minimal, correct async propagation.** Making a lazy loader async ripples into
  its accessor and call sites; the propagation MUST be traced and correct — no
  dropped promise, no lost fail-open, no double-arm across the new async boundary.
- **Lock the regression.** A future edit MUST NOT silently reintroduce a
  synchronous `require()` of a TLA-bearing `*-live` seam and re-break the build.

## Considered Options

- **Option A — Convert each compile-rejected `require("./x-live")` to a dynamic
  `await import("./x-live")`, propagate async minimally to the accessors/callers,
  add a `pending`-dedupe guard where the accessor becomes async, and lock the
  invariant with a source guard (chosen).** `bun build --compile` permits a
  dynamic import of a TLA module (it is evaluated asynchronously, as TLA requires).
  The deferral is preserved — the module is still fetched only on first arm — and
  behavior is identical but for one microtask of load timing.
- **Option B — Remove the top-level `await` from `core/global.ts`.** Rejected:
  `global.ts`'s TLA is a foundational initialization contract used across the
  whole workspace; unwinding it into a lazy init is a large, high-blast-radius
  refactor that this build-fix does not warrant, and it would change global
  startup semantics far beyond the two seams.
- **Option C — Convert the lazy `require()` to an eager static top-level import
  of the `*-live` module.** Rejected: it would arm the process singletons — and
  dereference the Bun global / `AppRuntime` — at *import* time, defeating the
  deliberate 017/018/019 deferred-arming design and re-coupling the pure cores to
  the Bun runtime (breaking the non-Bun test-runner importability the lazy seam
  exists to protect).
- **Option D — Mark the live modules external / exclude them from the compile.**
  Rejected: the single-file binary must be self-contained; externalizing the live
  seams would leave the production artifact unable to resolve them at runtime.
- **Option E — Fix only the two sites, add no guard.** Rejected as insufficient:
  the same hazard recurs the next time a lazy `require()` is added over a
  TLA-reaching seam; a lightweight source guard keeps the compiled build honest in
  the unit suite without paying for a full compile there.

## Decision Outcome

Chosen option: **Option A**, because it restores the compiled binary at the root
cause (a compiler-incompatible synchronous `require()` of a TLA-bearing module)
while preserving the deferred-arming design verbatim and changing only module-load
timing.

Key decisions recorded:

1. **Dynamic import for the TLA-reaching live seams (FR-A).**
   `telemetry-export.ts:loadLiveDeps` and `executor-composition.ts:loadLiveDeps`
   load their `*-live` module via `await import("./x-live")` instead of
   `require("./x-live")`. Both loaders are (or become) `async`. The
   `bun-cron-adapter` `require()` (`executor-composition-live.ts:446`) is left
   unchanged because it does not transitively reach a top-level await and the
   compiler accepts it (empirically confirmed by a clean compile).
2. **Async propagation, traced and minimal (FR-B).** `telemetry-export`'s
   `loadLiveDeps` was already `Promise`-returning and consumed by the already-async
   `ensureTelemetryExport`; no caller changed. `executor-composition`'s
   `ensureExecutorComposition` becomes `Promise`-returning; its two production call
   sites are updated: `server.ts` fire-and-forgets it
   (`void ...ensureExecutorComposition().catch(() => {})`, arming still eager at
   `listen()`), and the operator run-now port (`stack-live.ts:jobsRunNow`) chains
   `.then((composition) => composition.enqueueImmediate({...}))` — its
   `RunNowEnqueuePort` already returns a `Promise`, so no contract widens.
3. **Exactly-once preserved across the new async boundary (FR-C).** The sync
   `ensureExecutorComposition` got exactly-once for free (no yield). The async
   version adds a `pending: Promise<ExecutorComposition> | undefined` in-flight
   guard mirroring `ensureTelemetryExport`, so two concurrent callers before the
   singleton resolves share one arming and never double-arm nor mis-return a
   `disarmed` while an arm is in flight. `__resetExecutorCompositionForTests`
   clears `pending`.
4. **Fail-open and eager-arm-at-listen unchanged (FR-C).** A construction/arming
   fault still degrades to a `disarmed` composition / pipeline; the server still
   starts; the arm still fires from `server.listen()` (one microtask later). No
   behavior changes except load timing.
5. **Compiled-build regression guard (FR-D).** A lightweight unit guard
   (`test/jobs/compile-safe-live-load.test.ts`) asserts neither `routing/
   telemetry-export.ts` nor `jobs/executor-composition.ts` contains a synchronous
   `require("./*-live")` and that each uses `await import("./*-live")`, with a
   comment pointing to this feature. It intentionally does NOT run `bun build
   --compile` (too heavy for the unit suite); the compile itself remains the hard
   gate exercised by the build script.
6. **No contract change (invariant).** No public payload, command id, catalog
   version, dispatch path, server/port surface, or feature flag is added or
   altered; this is a module-load-mechanism correctness change plus a regression
   guard.

### Consequences

- Good: the production compiled build is restored — `bun run build --single`
  exits 0 and emits `dist/opencode-darwin-arm64/bin/opencode` (132 MB), passing
  its `--version` smoke test.
- Good: the deferred-arming design is preserved verbatim — importing the pure
  composition modules still never dereferences the Bun global / `AppRuntime`, the
  singletons arm only at `listen()` (or lazily for CLI `op`), and the non-Bun
  test-runner importability is intact.
- Good: the `pending`-dedupe guard makes the now-async
  `ensureExecutorComposition` exactly-once and fail-open across the async
  boundary, matching the already-hardened `ensureTelemetryExport`.
- Good: the source guard fails fast in unit CI if a future edit reintroduces a
  compile-rejected `require()` of a `*-live` seam — the compiled build cannot
  silently break the same way again.
- Neutral (documented boundary): the live modules now load one microtask later
  (a dynamic `import()` vs a synchronous `require()`). This is immaterial — both
  were already deferred to first-arm; the arm at `listen()` is fire-and-forget and
  the run-now port already returned a promise.
- Bad (residual): `bun-cron-adapter` keeps a synchronous `require()` — correct
  today (it does not reach a top-level await), but if a future edit makes it (or
  any other left-as-`require` seam) transitively import a TLA module, the compile
  breaks again there. The source guard covers the two `*-live` seams; a full
  compile in CI remains the backstop for any new hazard.

## Related

- Feature specification: [022 Restore the production compiled build the lazy live module](../sdd/022-restore-the-production-compiled-build-the-lazy-live-module/spec.md)
- Telemetry export process singleton + lazy live seam: [ADR-0019 Complete the semantic binding lifecycle and the remaining operator residuals](0019-complete-the-semantic-binding-lifecycle-and-the-remaining.md), [Feature 019](../sdd/019-complete-the-semantic-binding-lifecycle-and-the-remaining/spec.md)
- Executor composition process singleton + eager arm at listen: [ADR-0018 Compose the scheduled-jobs executor runtime into the live stack](0018-compose-the-scheduled-jobs-executor-runtime-into-the-live.md), [Feature 018](../sdd/018-compose-the-scheduled-jobs-executor-runtime-into-the-live/spec.md)
- Process-singleton eager-seam precedent (`ensureProcessSpoolWriter`): [Feature 017 Close the implementable operator capability gaps](../sdd/017-close-the-implementable-operator-capability-gaps-so-the/spec.md)
- OTLP telemetry foundation: [ADR-0001 OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)
- Domain schema: [restore-the-production-compiled-build ValueObject](../schemas/restore-the-production-compiled-build-the-lazy-live-module.cue)
