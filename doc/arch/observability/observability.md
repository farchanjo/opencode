# Observability Strategy

How OpenCode is observed: which signals exist, how they are named, and where they
are exported. Keep this in sync with Feature 001 telemetry domain ops and Feature
007 operator OTEL (content-free labels only).

## Signals

The three OTLP signal families OpenCode emits:

- **Metrics** — rates, latencies, and saturation for operator dispatch and runtime.
- **Logs** — structured, trace-correlated log records (secret-free).
- **Traces** — spans for operator command dispatch and session/runtime work.

## Metrics

Name metrics after the thing measured (e.g. operator dispatch duration), not after
a team or dashboard. Prefer histograms for latency, counters for throughput, and
gauges for saturation. Every metric documents its unit.

The routing domain (Feature 001, `telemetry-instruments.ts`) is the primary metric
source. Each smart-routing pass emits one `routing.decision` signal carrying the
selected role/tier, the survived-candidate count, and the `budget_consumed`
throughput (turns, tokens, bytes) measured against the active `BudgetPolicy`; a
worker→manager promotion emits a `hierarchy.escalation` signal with the escalation
count and structured threshold name. All values are structured scalars derived from
the decision record — never the task text, prompt, or model output that produced
them. Latencies (decision-model round-trip, dispatch admission) are histograms;
routing-event and escalation tallies are counters; budget headroom and fanout
saturation are gauges.

Operator control plane (Feature 007 / T046) attaches only content-free attributes
to dispatch spans/metrics. Payload, paths, secrets, project ids, and user text are
forbidden on metric labels; the routing signals reuse the same bounded label sets
declared in the Cardinality table below. Instruments export over OTLP to the
configured collector (`vm.services:4318` in the reference telemetry environment)
only when the operator has enabled `telemetry.*`; with telemetry off, the
instruments are inert and no signal leaves the process.

## Logs

Log records are structured (key/value), carry trace context when available, and
use severity levels consistently. No secrets, tokens, or plaintext credentials
appear in log payloads. Operator audit content lives in EventV2 audit records
(90-day retention), not in free-form log bodies.

## Tracing

One span family for operator dispatch (`command_id` / domain / surface / outcome).
Runtime LLM/session traces remain separate; admin slash/CLI/API paths make zero
provider calls by default and must not invent LLM spans for management work.

## Cardinality

Bounded label sets only. Never use `user_id`, `request_id`, `session_id`, `email`,
or free-form `uuid` as metric labels. Request-scoped ids belong on trace spans.

Declare every custom metric label in the table below with its bounded value set
and the signal it scopes. `speckit validate` scans this table (never the prose
above it), so keep it accurate.

| Label      | Bounded Value Set                                                                                                                                                                 | Signal                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| command_id | reserved operator catalog dotted IDs (v1 closed set from `@opencode-ai/core/operator`)                                                                                            | operator dispatch metrics/spans |
| domain     | telemetry, smart, routing, budget, pools, process, task, jobs, langlock, output, semantic, mcp                                                                                    | operator dispatch               |
| surface    | palette, slash, cli, settings, app, desktop, api, system                                                                                                                          | operator dispatch               |
| scope_kind | global, project, session, root-tree                                                                                                                                               | operator dispatch               |
| outcome    | success, idempotent_replay, conflict, audit_pending, unavailable, confirmation_required, not_implemented, and closed error codes                                                  | operator dispatch               |
| error_code | unauthorized, forbidden_scope, conflict, idempotent_replay, invalid_argument, reserved_name, confirmation_required, unavailable, secret_backend, transport_error, not_implemented | operator error metrics          |
| retry      | true, false                                                                                                                                                                       | operator dispatch               |
| http_route | closed operator loopback routes (GET /operator/v1/health, GET /operator/v1/registry, POST /operator/v1/commands)                                                                  | operator API metrics            |
| routing.task_class | small, medium, large, complex | routing.decision |
| routing.routing_profile | direct_worker, manager | routing.decision |
| routing.hierarchy_role | architect, manager, worker | routing.decision |
| routing.scope | session, project, global, root-tree | routing.decision, budget.consumption |
| routing.offline | true, false | routing.decision |
| routing.decision_model_called | true, false | routing.decision |
| budget.scope | session, project | budget.consumption |
| budget.outcome | ok, blocked, error, escalation | budget.breach |
| budget.dimension | max_turns, max_context_tokens, max_output_tokens, token_budget, cost_usd, time_ms, unspecified | budget.breach |
| hierarchy.parent_role | architect, manager, worker | hierarchy.fanout |
| hierarchy.child_role | architect, manager, worker | hierarchy.fanout |
| hierarchy.admitted | true, false | hierarchy.fanout |
| hierarchy.denied_reason | illegal_transition, depth_exceeded, parent_not_orchestrator, admission_denied, model_unresolved, unspecified | hierarchy.fanout |
| orchestration.worker_lifecycle | pending, done, failed, aborted | orchestration.worker |
| orchestration.delivery | foreground, background | orchestration.worker |
| orchestration.validation | accepted, rejected, none | orchestration.worker |
| orchestration.fail_action | reject, reject_redispatch, surface_blocked | orchestration.worker |
| orchestration.pending_workers | bounded worker count 0..max_workers | orchestration.gate |

## OTLP Conventions

Export telemetry from the application boundary over OTLP: gRPC on port 4317 or
HTTP on port 4318 when the operator has enabled telemetry (`telemetry.*` via the
operator control plane). Resource attributes name the service
(`service.name = "opencode"`).

Operator-only test signal: `telemetry.test` emits a clearly marked OTLP test
signal or connectivity mode — never an LLM call.

## Phase 2 note

App/Desktop-specific chrome metrics are deferred with T090–T091. Multi-user actor
labels are deferred with T092. Phase 1 does not claim those label sets.
