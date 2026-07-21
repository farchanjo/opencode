# Tasks: Emit Real Opentelemetry Spans And Metrics For Routing

## Task Breakdown

- [ ] T001 Expose a domain-signal `offer` on the shipped export pipeline
  (`routing/telemetry-export.ts`): add `emitDomainSignal` to the pipeline
  interface (armed forwards to the adapter offer; disarmed is a no-op), plus
  module helpers `recordDomainSignal` and `isTelemetryArmed`.
- [ ] T002 Add pure, SDK-free attribute mappers
  (`routing/application/telemetry-emitters.ts`): one builder per domain
  (`routingDecisionSignal`, `budgetConsumptionSignal`, `budgetBreachSignal`,
  `fanoutAdmissionSignal`, `orchestrationWorkerSignal`, `completionGateSignal`)
  returning a signal from the closed structural allow-list, plus armed-gated
  `emit*` wrappers that never throw.
- [ ] T003 Wire routing-decision emission at the live session seam
  (`session/routing-resolve.ts`) after a decision resolves.
- [ ] T004 Wire budget-consumption and breach emission at the processor budget
  seam (`session/processor.ts` step-finish).
- [ ] T005 Wire fan-out admission emission at the hierarchy resolver
  (`session/routing-hierarchy.ts`) on both route (granted) and blocked (denied).
- [ ] T006 Wire orchestration-outcome emission at the worker terminal fold
  (`tool/task.ts` seam) via a pure outcome mapper.
- [ ] T007 Tests (`test/telemetry/routing-emitters.test.ts`): each domain emits
  the right signal and attributes; a failing or absent exporter never breaks
  routing (hang-safety); disabled telemetry emits nothing (byte-identical); no
  secret attribute is present.
- [ ] T008 Register the Feature 047 source globs in `doc/arch/speckit.toml` and
  keep `doc/arch/observability/observability.md` Cardinality in sync.

## Dependencies

- The shipped OTLP export pipeline (Feature 001/019): `telemetry-export.ts`,
  `otlp-adapter.ts`, `otlp-transport.ts`, and the core `BoundedExportQueue`.
- The live routing, budget, fan-out, and orchestration seams shipped by Features
  037/042/043/044. No external systems; tests use an in-memory exporter, never
  the live collector.
