---
status: accepted
date: 2026-07-21
deciders: [routing-team]
consulted: [observability]
informed: [operator]
---

# Emit Real Opentelemetry Spans And Metrics For Routing

## Context and Problem Statement

The routing stack computes rich structural signals on every turn — a routing
decision (role/pool/model/task-class/profile), per-turn budget consumption and
breaches, fan-out admission (granted/denied/count), and orchestration outcomes
(worker terminal state, completion gate, validation). None of this is observable
in production for the live session path.

A mature OTLP export pipeline already ships (Feature 001/019): a process-
singleton, fail-open, disabled-disarmed pipeline (`telemetry-export.ts`) that
binds a real `http/protobuf` OTLP/JSON transport (`otlp-transport.ts`), drains a
bounded, non-blocking queue (`otlp-adapter.ts` over the core `BoundedExportQueue`)
on an `unref`'d periodic flush, and runs a privacy redaction pass before any
signal is queued. But it exposes only its own housekeeping counters
(`opencode_telemetry_*`, operator mutations, session count). The routing decision
bridge (`createRoutingDecisionTelemetry`) exists but is wired in `stack-live.ts`
to an adapter built WITHOUT a transport — an offline sink whose queue is never
drained — and the LIVE session decision seam (`routing-resolve.ts`) passes no
telemetry at all. Budget, fan-out, and orchestration emit nothing.

How should the four domains emit real spans and metrics without ever slowing,
hanging, or breaking a routing turn, and without leaking any secret or user text?

## Decision Drivers

- Emission must be non-blocking, hang/crash-safe, and byte-identical when
  telemetry is disabled (the F037/F043 hot-path safety contract).
- No secret, prompt, or response text may ever reach an attribute.
- Avoid duplicating the shipped hang-safe export machinery or double-exporting to
  the same endpoint.
- Attribute mapping must be pure and unit-testable in isolation from the SDK.

## Considered Options

- **Option A — Reuse the shipped OTLP export pipeline.** Expose a domain-signal
  `offer` on the process-singleton pipeline and feed it from pure per-domain
  attribute-mapping functions wired at the four live seams. Emission is an
  in-memory enqueue; the existing background flush does the network.
- **Option B — Stand up a second `@effect/opentelemetry` NodeSdk Meter/Tracer
  layer for routing.** Construct a parallel provider and exporter dedicated to
  the four domains.
- **Option C — Await a direct OTLP export at each seam.** Emit synchronously in
  the turn.

## Decision Outcome

Chosen option: **Option A — reuse the shipped OTLP export pipeline**, because it
already satisfies every non-negotiable constraint and adding a second exporter
would duplicate the battle-tested hang-safety and double-export to the same
collector.

- **Real egress, not a stub.** `createHttpOtlpTransport` POSTs spec-valid
  OTLP/JSON to `<endpoint>/v1/{metrics,traces}`; the singleton binds it from the
  effective `global:telemetry` config. This is the real OpenTelemetry export path
  the four domains ride.
- **`@effect/opentelemetry` scope.** It remains the mechanism for per-request
  LLM/session provider spans (`session/llm.ts`, `agent/agent.ts`) and operator
  dispatch spans (`operator/adapters/outbound/otel-live.ts`) — a distinct concern
  (live provider tracing) from routing-decision metrics. Constructing a second
  Meter for routing would duplicate the shipped queue/timeout/drop/disabled
  machinery and contend on the same endpoint, so it is rejected.
- **Fire-and-forget mechanism.** Each seam calls a synchronous emit helper that
  (1) short-circuits when the pipeline is not `armed`, (2) builds the signal from
  a pure mapper, (3) enqueues via the pipeline's `offer` (in-memory, bounded,
  drop-on-full), and (4) swallows any error. The network happens only on the
  pipeline's background `unref`'d flush, bounded per request by an
  `AbortController`. No seam awaits export.
- **Hang/crash-safe.** A slow/down collector resolves as a bounded timeout →
  discard → `exportError++` on the background timer; the hot path only ever did an
  in-memory enqueue, so turn latency is unaffected and no error propagates.
- **Disabled byte-identical.** The `armed`-state guard runs first, so a disabled
  authority allocates no signal object, builds no attribute bag, and constructs no
  transport on the hot path.
- **Attribute allow-list.** Pure mappers emit only the enumerated structural
  scalars (model id, role, pool, scope, task class, routing profile, counts,
  token/cost totals, booleans, durations, bounded typed reasons). The redaction
  pass in `offer` strips any prompt/secret/path/content key as defense-in-depth.
- **Metric cardinality discipline.** Metric DIMENSIONS carry only bounded-
  cardinality labels (scope, role, booleans, closed-set enums, small bounded
  counts). Per-turn MONOTONIC totals (turns/tokens/cost) would mint a fresh
  time-series every turn, so `budget.consumption` is emitted as a SPAN (per-trace,
  cardinality-safe) rather than a metric; `budget.breach` stays a counter because
  its labels are bounded enums.
- **Unconstrained-string labels are scrubbed.** A model/pool id is an
  unconstrained non-empty string a self-hosted provider could embed auth into
  (e.g. `scheme://user:token@host`), which the name-keyed redaction pass cannot
  see. The mapper therefore length-bounds AND value-scans these labels
  (inline URL creds, bearer/`sk-` tokens, `key=value` auth) before emit;
  structural ids pass through unchanged. Free-text reasons collapse to a closed
  set (`DispatchRejectionReason` + synthetic `model_unresolved`, else
  `unspecified`).

### Consequences

- Good: zero new dependency, one export pipeline, one hang-safety contract; pure
  mappers are trivially unit-testable; disabled builds pay nothing.
- Good: the live session decision seam becomes observable (it emitted nothing
  before), closing the disconnected-adapter gap.
- Bad: the shipped OTLP/JSON encoder renders metric points as single-point gauges
  rather than native counter/histogram instrument types; the instrument
  semantics (counter/histogram) are documented in the contract and schema, and a
  future encoder upgrade can promote them without changing the emit seams.

### Known residual — label sanitizer scope

`sanitizeLabel` scrubs the realistic credential shapes an OTLP string label
could carry (inline URL creds `user:pass@`, `Bearer` tokens, `key=value` auth,
`sk-`/`pk-`/`gh*_` prefixes) and length-bounds the value; the scrub runs on the
full value before the clamp so truncation cannot reveal an unscrubbed tail. It is
a defense-in-depth layer over the adapter's name-keyed redaction pass — the emit
source (`decision.selection.executor_model`) is a structural catalog model id,
not free-form user text. It deliberately does not attempt entropy scanning
(would false-positive on legitimate model ids), so a bare high-entropy secret
with no known prefix/delimiter, an all-caps `BEARER`, or an `access_token=`
variant would pass; these are out of scope for a structural-id label and are
covered upstream by not sourcing labels from free-form text.
