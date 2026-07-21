---
id: 019f8418-158d-75d0-bcb0-651eb18c63af
number: 047
slug: emit-real-opentelemetry-spans-and-metrics-for-routing
status: implemented
created_at: 2026-07-21T09:53:18.733863Z
---
# Feature Specification: Emit Real Opentelemetry Spans And Metrics For Routing

Feature: 047-emit-real-opentelemetry-spans-and-metrics-for-routing
Created: 2026-07-21

## User Stories

- As an operator running Smart Routing in production, I want the routing engine
  to emit real OpenTelemetry spans and metrics for its routing decisions, budget
  consumption, fan-out admission, and orchestration outcomes, so that I can
  observe why a task was routed, how much budget it burned, whether fan-out was
  granted, and how delegated workers terminated — without ever slowing, hanging,
  or breaking a routing turn, and without any user prompt, response, or secret
  leaving the process.
- As a privacy-conscious operator, I want telemetry to be byte-identical to a
  no-telemetry build when the telemetry authority is disabled, so that enabling
  observability is an explicit, reversible opt-in that adds zero overhead when
  off.

## Functional Requirements

1. **Four emission domains.** When the telemetry authority (`global:telemetry`
   or `telemetry`) is enabled with an OTLP endpoint configured, the routing/
   session stack MUST emit OTLP signals for four domains, each grounded at the
   live seam that produces its data: (a) routing decisions, (b) budget
   consumption, (c) fan-out admission, (d) orchestration outcomes.
2. **Routing-decision emission.** A committed routing decision emits a
   `routing.decision` span plus a `routing.decision` metric point carrying only
   structural scalars: `routing.task_class`, `routing.routing_profile`,
   `routing.hierarchy_role`, `routing.selected_model`, `routing.scope`,
   `routing.authorized_count`, `routing.decision_model_called`,
   `routing.offline`, and `routing.latency_ms`. Emission is grounded at the live
   session decision seam (`session/routing-resolve.ts`) so the top-level
   selection is observed, not only the operator-invoked evaluation.
3. **Budget-consumption emission.** Each recorded per-turn spend emits a
   `budget.consumption` SPAN (`budget.turns_used`, `budget.context_tokens_used`,
   `budget.output_tokens_used`, `budget.cost_usd_used`, `budget.scope`) — a span,
   not a metric, because those are monotonic per-turn running totals that as
   metric dimensions would mint a fresh time-series every turn (unbounded
   cardinality). On a hard-stop breach (`blocked`/`error`) it also emits a
   `budget.breach` counter whose labels are the bounded `budget.outcome`, the
   breached `budget.dimension` (a bounded sentinel `unspecified` when no
   per-dimension violation is present), and `budget.scope` only — never the
   offending value's surrounding text. Metric DIMENSIONS carry only
   bounded-cardinality labels; per-turn-varying numbers live on spans or as the
   metric point value.
4. **Fan-out-admission emission.** A fan-out admission decision emits a
   `hierarchy.fanout` span/metric carrying `hierarchy.parent_role`,
   `hierarchy.child_role`, `hierarchy.fanout_requested`,
   `hierarchy.fanout_granted`, `hierarchy.admitted` (boolean), and, on a denial,
   a bounded `hierarchy.denied_reason` drawn from the engine's typed rejection
   reason (never free user text).
5. **Orchestration-outcome emission.** A delegated worker's terminal transition
   emits an `orchestration.worker` span/metric carrying
   `orchestration.worker_lifecycle` (`done`/`failed`/`aborted`),
   `orchestration.delivery` (`foreground`/`background`),
   `orchestration.validation` (`accepted`/`rejected`/`none`), and an optional
   `orchestration.fail_action`; a blocked completion gate emits an
   `orchestration.gate` metric with `orchestration.pending_workers`.
6. **Non-blocking, fire-and-forget.** Emission MUST NOT be awaited on the
   routing/session hot path. Each emit does only a bounded, in-memory enqueue and
   returns immediately; the actual network export runs on a background,
   `unref`'d periodic flush. A routing turn's latency MUST be unaffected by
   emission.
7. **Hang/crash-safe.** A slow or unreachable OTLP collector MUST NEVER hang,
   slow, or fail a routing turn. Export is bounded by an `AbortController`
   timeout, drops on failure, and degrades silently; any emission error is
   swallowed and never propagates to the session.
8. **Disabled is byte-identical.** When the telemetry authority is absent or
   disabled, or no OTLP endpoint is configured, the stack emits nothing and adds
   zero hot-path overhead: the armed-state check short-circuits BEFORE any signal
   object or attribute bag is allocated, and no tracer/meter/transport is
   constructed on the critical path.
9. **Attribute allow-list, no secret leakage.** Span/metric attributes are drawn
   only from the enumerated structural allow-list (model ids, role, pool, scope,
   task class, routing profile, counts, token/cost totals, booleans, durations,
   bounded typed reasons). No attribute may carry an API key, credential, prompt,
   or response text. Free-text reasons collapse to a bounded closed-set value.
   Because a model/pool id is an unconstrained string that a self-hosted provider
   could embed auth into, every emitted model/pool label is BOTH length-bounded
   AND value-scanned to scrub inline URL credentials (`user:pass@`), bearer/`sk-`
   tokens, and `key=value` auth material before it can reach the collector
   (structural ids pass through unchanged). The shipped name-keyed redaction pass
   runs as further defense-in-depth before any signal is queued.
10. **Independent of Smart-Routing activation.** Telemetry is gated only on the
    telemetry authority, not on Smart-Routing activation: an observable seam that
    runs with routing disabled still emits when telemetry is on, and every seam
    is byte-identical when telemetry is off.
11. **Reuse the shipped export pipeline.** Emission reuses the already-shipped,
    process-singleton, fail-open OTLP export pipeline (`telemetry-export.ts`,
    `otlp-adapter.ts`, `otlp-transport.ts`) — the real OTLP/HTTP egress — rather
    than constructing a second, parallel exporter to the same endpoint.

## Security Requirements

- **Data sensitivity/classification.** This feature reads structural routing
  metadata already computed in-process (task class, routing profile, role, pool,
  selected model id, token/cost counts, worker lifecycle) and exports it over
  OTLP. It reads no new sensitive data; the raw task text, prompts, model
  responses, and file content that produced these scalars are never read into an
  attribute. The exported set is a bounded, content-free projection.
- **Authentication/authorization.** No new authenticated surface is introduced.
  Export header material (for an authenticated collector) is resolved only by the
  composition root through the existing `SecretPort` and written solely into
  request headers, never into a span/metric attribute or a log body.
- **Input validation.** The only untrusted magnitudes are token/cost counts and
  free-text reasons. Counts are already clamped to safe non-negative values by
  the budget seam; reasons are bounded to a short, secret-free string and drawn
  from the engine's typed rejection/validation vocabulary, not from user text.
- **Cryptography in transit/at rest.** The feature persists nothing. Transit
  encryption is the collector endpoint's TLS profile, handled by the shipped
  transport; this feature adds no new at-rest data.
- **Logging/audit.** The feature emits OTLP metrics and spans only. It writes no
  new log records and records no sensitive material; the redaction pass strips
  any prompt/secret/path/content key defensively before enqueue.
- **Error-handling information exposure.** Every emission path swallows its own
  errors and never surfaces a message to the session. Bounded reasons on spans
  are capped in length and carry only typed rejection/outcome vocabulary, so an
  error path cannot leak sensitive detail.

## Acceptance Scenarios

Given telemetry is enabled with a reachable OTLP endpoint
When  a routing decision is committed at the live session seam
Then  a content-free `routing.decision` span and metric point reach the endpoint
      carrying only the allow-listed structural attributes.

Given telemetry is enabled and a per-turn budget hard-stop breach occurs
When  the budget seam records and re-evaluates the running total
Then  a `budget.consumption` point and a `budget.breach` counter are emitted, and
      the routing turn completes without waiting on the export.

Given telemetry is enabled but the OTLP collector is slow or down
When  the four domains emit during a routing turn
Then  the routing turn completes normally with unaffected latency, the exports
      drop silently, and no error propagates to the session.

Given the telemetry authority is disabled
When  any of the four seams runs
Then  no signal is emitted, no tracer/meter/transport is constructed, and the
      behavior is byte-identical to a build without this feature.

## Observability

How this feature is observed in production: the metrics it emits, the log
events it writes, and the trace spans it creates. Export telemetry via OTLP
from the application boundary; keep metric label sets bounded, and carry
request-scoped identifiers on trace spans. Conventions live in
`doc/arch/observability/observability.md`.

This feature IS the observability surface for the routing stack: it emits the
`routing.decision`, `budget.consumption`, `budget.breach`, `hierarchy.fanout`,
`orchestration.worker`, and `orchestration.gate` signals declared in the
Cardinality table of `doc/arch/observability/observability.md`. Every label set
is bounded and content-free; request-scoped identifiers (decision id, session
id) are never used as metric labels. All export flows through the shipped
process-singleton OTLP pipeline and is inert when telemetry is disabled.

## Clarifications
