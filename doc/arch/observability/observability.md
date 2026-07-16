# Observability Strategy

How opencode is observed in production: which signals exist, how they
are named, and where they are exported. Operators own this document — edit it
as the telemetry surface evolves, and keep it in sync with the `## Observability`
sections of the functional docs and feature specs.

## Signals

The three OTLP signal families opencode emits:

- **Metrics** — numeric health and usage series (rates, latencies, saturation).
- **Logs** — structured, trace-correlated log records.
- **Traces** — end-to-end request spans across component boundaries.

## Metrics

Name metrics after the thing measured (e.g. `http.server.request.duration`),
not after a team or a dashboard. Prefer histograms for latency, counters for
throughput, and gauges for saturation. Every metric documents its unit.

## Logs

Log records are structured (key/value), carry the trace context of the request
that produced them, and use severity levels consistently. No secrets or
credentials ever appear in log payloads.

## Tracing

One trace per external request. Spans name the operation, not the function.
Request-scoped identifiers travel as span attributes so correlated logs and
bounded metrics can stay lean.

## Cardinality

Bounded label sets only: every metric label must have a small, finite value
set. Never use `user_id`, `request_id`, `session_id`, `email`, or `uuid` as metric labels.
Request-scoped ids belong on trace spans, not on metric labels.

Declare every custom metric label in the table below with its bounded value
set and the signal it scopes. A project that emits no custom metric labels
writes the line `No custom metric labels.` in place of the table. `speckit
validate` scans this table (never the prose above it), so keep it accurate.

| Label | Bounded Value Set | Signal |
|-------|-------------------|--------|
| http_route | closed route table (e.g. GET /health, POST /orders) | request metrics |

## OTLP Conventions

Export telemetry from the application boundary over OTLP: gRPC on port 4317 or
HTTP on port 4318. Resource attributes name the service
(`service.name = "opencode"`) so every signal is attributable to its
origin.
