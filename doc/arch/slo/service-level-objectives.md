# Service Level Objectives

How OpenCode defines SLIs and SLOs for Phase 1 local / loopback operation.
Targets are operator-facing and runtime-local; multi-user remote SLAs are Phase 2
(T092). Keep metrics labels content-free per
[observability](../observability/observability.md).

## Scope

- **In scope:** loopback operator HTTP, native CLI (`opencode op`), TUI slash
  intercept, local offline-capable status/query paths, sandbox isolation.
- **Out of scope:** public remote multi-tenant API latency, App/Desktop chrome
  (T090–T091), third-party LLM provider SLAs.

## Indicators (SLIs)

| ID    | SLI                              | Measurement                                                                 | Window   |
| ----- | -------------------------------- | --------------------------------------------------------------------------- | -------- |
| SLI-01 | loopback command latency        | histogram of operator dispatch duration from accept to redacted result      | 5m rolling |
| SLI-02 | loopback health availability    | success ratio of `GET /operator/v1/health` on loopback                      | 30d      |
| SLI-03 | offline admin path purity       | count of provider/model calls on reserved admin command paths               | per dispatch |
| SLI-04 | audit durability                | fraction of mutations that either publish EventV2 audit or return `audit_pending` with durable CAS | 30d |
| SLI-05 | sandbox isolation               | production config path writes during harness runs                           | per CI run |

## Objectives (SLOs)

| ID    | Objective                                                                 | Target                         | Error budget | Related SLI |
| ----- | ------------------------------------------------------------------------- | ------------------------------ | ------------ | ----------- |
| SLO-01 | Loopback operator command p95 latency (local offline-capable queries)    | ≤ 200 ms                       | 1% of samples over target | SLI-01 |
| SLO-02 | Loopback operator command p99 latency (local offline-capable queries)    | ≤ 500 ms                       | 0.1% of samples over target | SLI-01 |
| SLO-03 | Loopback health endpoint availability                                    | ≥ 99.5% success                | 0.5% downtime | SLI-02 |
| SLO-04 | Admin / reserved paths issue zero LLM tokens by default                  | 100% (hard invariant)          | none — fail closed | SLI-03 |
| SLO-05 | Mutations never silent-success without audit or `audit_pending`          | 100% (hard invariant)          | none — fail closed | SLI-04 |
| SLO-06 | Operator sandbox never writes production `~/.config/opencode`            | 100% (hard invariant)          | none — fail closed | SLI-05 |

Loopback latency SLOs apply to **local offline-capable** operator queries (e.g.
`langlock.status`, `flag.show`, `telemetry.status`, `GET /operator/v1/registry`).
They do **not** include remote embedding/Milvus/provider round-trips; those are
capability gaps with typed degradation, not loopback SLO breaches.

## Error Budget Policy

- Soft latency budgets (SLO-01/02): investigate when burn rate exceeds 2× for
  one hour on a developer host; document regressions in quality scenarios.
- Hard invariants (SLO-04–06): any breach is a release blocker; fix before ship.
- `audit_pending` counts toward SLI-04 success when CAS is durable and outbox
  reconcile is scheduled — not a silent drop.

## SLO-

Named Phase 1 objectives (see table above for full targets):

- **SLO-01 / SLO-02** — loopback offline-capable operator latency (p95 ≤ 200 ms,
  p99 ≤ 500 ms).
- **SLO-03** — loopback health availability ≥ 99.5%.
- **SLO-04** — admin / reserved paths issue zero LLM tokens by default (hard).
- **SLO-05** — mutations never silent-success without audit or `audit_pending` (hard).
- **SLO-06** — operator sandbox never writes production user config (hard).

## Alerting (local / operator)

Phase 1 has no multi-user pager. Operators act on structured outcomes and OTEL
when `telemetry.*` is enabled:

| Condition                                      | Action                                              |
| ---------------------------------------------- | --------------------------------------------------- |
| p95 dispatch latency sustained above SLO-01    | check local load; inspect content-free OTEL metrics |
| health route failing                           | confirm loopback bind and flag resolution           |
| admin path provider call detected              | treat as security defect; halt admin surface ship   |
| sandbox write outside `.dev/opencode-operator` | fail isolation proof; do not merge                  |

## Reporting

- Quality scenarios: [quality-scenarios.md](../quality/quality-scenarios.md)
  (QS-02 performance-efficiency, QS-08 flexibility/sandbox).
- Operations procedures: [operations.md](../operations/operations.md).
- Metrics export: OTLP when telemetry enabled; instruments inert when off.

## Phase 2 note

Remote non-loopback API SLOs, multi-user availability, and App/Desktop chrome
latency are deferred with T090–T092. Do not treat their absence as Phase 1 SLO
defects.
