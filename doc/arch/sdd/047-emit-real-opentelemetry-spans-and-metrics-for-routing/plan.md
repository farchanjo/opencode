# Implementation Plan: Emit Real Opentelemetry Spans And Metrics For Routing

## Overview

Emit real, content-free OpenTelemetry spans and metrics for four routing
domains — decision, budget consumption, fan-out admission, and orchestration
outcomes — fire-and-forget on the hot path, hang-safe on collector failure, and
byte-identical to a no-telemetry build when the telemetry authority is off.
Full signal vocabulary, label rules, and acceptance criteria are in
[spec.md](spec.md) for feature
`047-emit-real-opentelemetry-spans-and-metrics-for-routing`.

## Technical Approach

Ground emission at the live seams that already produce the data
(`session/routing-resolve.ts`, budget spend, hierarchy fan-out, orchestration
worker/gate outcomes), reusing the ADR-0001 / Feature 001 OTLP exporter and
bounded-cardinality helpers. Enqueue only in memory on the turn path; export on
an `unref`'d background flush with timeout/drop. Metric dimensions stay
bounded enums; per-turn-varying totals live on spans or as metric values, never
as high-cardinality labels. No new exporter stack, no content/prompt/secret in
any signal.
