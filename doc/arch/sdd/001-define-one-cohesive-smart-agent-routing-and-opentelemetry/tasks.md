# Tasks: Define One Cohesive Smart Agent Routing And Opentelemetry

Ordered, measurable work breakdown derived from `plan.md` slices S0–S16,
`data-model.md`, `hierarchy-flow.md`, and `contracts/ports.ts`. Every task stays
inside the `specScopeGlobs` declared in `doc/arch/speckit.toml`. Phase 1
(telemetry) is additive and non-breaking; Phase 2 (routing) depends on ADR-0001
and ADR-0002 acceptance. All operator command surfaces register through the
Feature 007 registry; none hold management authority of their own.

## Task Breakdown

### Schema and protocol foundation

- [x] T001 Author `packages/schema/src/telemetry/config.ts` with the
  `TelemetryConfigSchema` from `data-model.md` (enabled, endpoint, transport,
  headers as SecretRef, tls, signals, queue, redact, resource_attributes,
  sampling clamped 0–1) and export `TelemetryConfig` plus `SecretRef`.
- [x] T002 Author `packages/schema/src/routing/budget.ts` with
  `BudgetPolicySchema`, `BudgetConsumptionSchema`, and
  `BudgetPolicySnapshotSchema`; pin `max_delegation_depth` to the constant 2 and
  export the three inferred types.
- [x] T003 Author `packages/schema/src/routing/config.ts` with
  `RoutingConfigSchema` (enabled, mode, strict_gates, decision_model pool,
  role_pools as RolePoolID→ModelID[], fallback floor_role, capability block,
  budget reference, hierarchy max_depth constant 2, orchestration_only) and the
  `RolePoolID`, `TaskClass`, `RoutingProfile`, `TaskEffort`, `ReasoningEffort`,
  `ExecutionBoundary` type aliases.
- [x] T004 Author `packages/schema/src/routing/decision.ts` with
  `GateResultSchema`, `CandidateRecordSchema`, `RankedCandidateSchema`,
  `AuthContextSnapshotSchema`, and the immutable `RoutingDecisionSchema` carrying
  id (ULID), version, session/turn IDs, task_fingerprint, classification fields,
  two-stage pipeline fields, gates, decision-model fields, ranking, budget
  snapshot, catalog/policy versions, auth context, execution boundary, fallback
  state, and metadata.
- [x] T005 Author `packages/schema/src/routing/capability.ts` with
  `ToolCapabilityDimensionsSchema` (seven nullable tool-call dimensions),
  `CapabilitySourceSchema`, `CapabilityRecordSchema` (source, confidence clamped
  0–1, ttl, scope), and `CapabilityMismatchSchema` with the three-way outcome.
- [x] T006 Author `packages/schema/src/routing/events.ts` with
  `HierarchyRoleSchema` and the `RoutingEventSchema` tagged union covering
  routing.decision, routing.fallback, hierarchy.dispatch, hierarchy.validation,
  hierarchy.escalation, capability.mismatch, todo.initialized, and
  todo.completion_blocked variants.
- [x] T007 Author `packages/schema/src/tui/smart-state.ts` with the
  `SmartIndicatorStateSchema` active/inactive union and its inferred type.
- [x] T008 Mirror the routing and telemetry command-payload contracts into
  `packages/protocol/src/routing/` and `packages/protocol/src/telemetry/` so the
  wire types match `contracts/ports.ts` request/response shapes for evaluate,
  explain, test, capability inspect, status, and the telemetry surface.

### Telemetry foundation (Phase 1)

- [ ] T009 Extend `packages/core/src/observability/otlp.ts` to export metrics and
  structured logs alongside traces, add a bounded export queue with configurable
  capacity and batch size, and apply the ADR-0001 cardinality allowlist so
  over-budget label values map to `other`.
- [ ] T010 Add `packages/core/src/observability/telemetry-instruments.ts`
  defining the concept spans (`routing.evaluate`, `decision_model`,
  `hard_gates`, `rank`, `task.execute`, `llm.request`, `tool.execute`,
  `fallback`) and the bounded-cardinality metric instruments (routing decision
  latency, hard-gate rejection count, authorized-candidate count, queue depth,
  export drops, exporter errors).
- [ ] T011 Implement the async bounded export queue drop and backpressure policy
  in `packages/core/src/observability/otlp.ts`, emitting queue-depth,
  queue-capacity, and drop-reason signals and never blocking the hot path.
- [ ] T012 Implement privacy redaction defaults in
  `packages/opencode/src/routing/application/telemetry-service.ts` that strip
  prompts, secrets, personal paths, file content, and tool payloads, with
  per-signal enablement gates from `TelemetryConfig`.
- [ ] T013 Implement `TelemetryPort` in
  `packages/opencode/src/routing/application/telemetry-service.ts` (status,
  enable, disable, show, configure, test signal-or-connectivity, flush) reading
  and writing config through the Feature 007 Config.Service adapter and resolving
  secrets through the SecretPort; all reads offline-capable and zero-cost.
- [ ] T014 Add the OTLP outbound adapter at
  `packages/opencode/src/routing/adapters/outbound/otlp-adapter.ts` wiring the
  telemetry service to the extended `otlp.ts` exporter with the bounded queue.

### Routing domain engine (Phase 2)

- [ ] T015 Implement `packages/opencode/src/routing/domain/classifier.ts`
  producing a `TaskClass` and `RoutingProfile` (`direct_worker` or `manager`)
  from the structured evaluation signals in `hierarchy-flow.md` (domain count,
  independent units, mutation/risk, ambiguity, context size, expected tools,
  parallelism, security/migration), deterministically and with no model call.
- [ ] T016 Implement
  `packages/opencode/src/routing/domain/capability-resolver.ts` resolving the
  seven tool-call dimensions from canonical catalog metadata, applying validated
  override overlays with source/confidence/TTL, and enforcing the conservative
  unknown policy (`deny` treats null dimensions as unmet).
- [ ] T017 Implement `packages/opencode/src/routing/domain/routing-evaluator.ts`
  hard-gate evaluation: reject candidates per unmet capability dimension, keep
  only the authorized set, and record `GateResult` reasons per candidate.
- [ ] T018 Extend `routing-evaluator.ts` with deterministic two-stage ranking
  (task → specialist agent → executor model) over the authorized set only,
  adding skill and effort dimensions and a deterministic tie-break recorded in
  the decision.
- [ ] T019 Implement the decision-model selection step in `routing-evaluator.ts`
  that picks from the authorized healthy pool without recursion, records
  structured decision inputs and outputs with no raw prompts, and skips the model
  when the bypass policy is met.
- [ ] T020 Implement `packages/opencode/src/routing/domain/routing-decision.ts`
  as the immutable decision record plus the atomic commit protocol (temp page →
  journal flag → atomic rename) with the `(session_id, turn_id,
  task_fingerprint)` idempotency key.
- [ ] T021 Implement fallback and execution-boundary classification in
  `packages/opencode/src/routing/domain/routing-evaluator.ts`: classify
  safe/retryable/mutation_risky, retry only authorized compatible candidates,
  never blind-repeat a mutation-risky candidate, and emit explicit
  `no_authorized_candidate` errors.
- [ ] T022 Implement `packages/opencode/src/routing/domain/budget-policy.ts`
  enforcing Context, Turn and Delegation Budget hard maximums (max_turns,
  context/output token and byte caps, max_workers, max_delegation_depth,
  retrieval/rerank/skill limits, time/cost/token budgets, retry and validation
  depth, escalation threshold) with explicit blocked/escalation/error on exceed
  and no silent truncation.
- [ ] T023 Implement
  `packages/opencode/src/routing/domain/hierarchy-dispatcher.ts` producing
  Architect → Manager → Worker dispatch envelopes at max depth 2, enforcing
  orchestration-only Architect/Manager, admission-controlled fanout
  (`min(requested, max_workers, cost_budget, token_budget)`), and reused
  evidence/OutputRefs/lineage on escalation.
- [ ] T024 Implement `packages/opencode/src/routing/domain/todo-authority.ts` as
  the session-owned Todo aggregate (exactly one per goal-bearing Session),
  non-empty snapshot gate before dispatch, completion gate on required items plus
  version plus validation step, durable snapshot outside message prose, and
  rehydration after compaction or restart.
- [ ] T025 Add `packages/opencode/src/routing/domain/errors.ts` with the typed
  routing errors mirrored from `contracts/ports.ts` (`no_authorized_candidate`,
  `catalog_mismatch`, `unavailable`, `invalid_argument`, `not_implemented`).

### Routing application, adapters, and session state (Phase 2)

- [ ] T026 Author `packages/opencode/src/routing/application/ports.ts` from
  `contracts/ports.ts` (RoutingPort, SmartPort, BudgetPort, PoolsPort) and
  `packages/opencode/src/routing/application/routing-service.ts` orchestrating the
  domain classifier, resolver, evaluator, budget policy, dispatcher, and decision
  store.
- [ ] T027 Author the outbound adapters
  `packages/opencode/src/routing/adapters/outbound/catalog-adapter.ts` (candidate
  resolution from Catalog.Service/ModelsDev only, no hardcoded model IDs),
  `config-adapter.ts` (routing config via Config.Service), and
  `event-adapter.ts` (routing/hierarchy/capability events via EventV2).
- [ ] T028 Author the inbound adapters under
  `packages/opencode/src/routing/adapters/inbound/` registering the routing
  command handlers with the Feature 007 dispatcher, parsing and dispatching input
  locally before prompt admission.
- [ ] T029 Add `packages/opencode/src/session/routing-state.ts` carrying the
  routing decision reference, hierarchy role, and budget consumption for a
  Session, and integrate `parent_session_id == current_session_id` direct-child
  correlation.
- [ ] T030 Extend `packages/opencode/src/session/todo.ts` with the session-owned
  aggregate, durable non-empty snapshot, read-only `TodoRef`/`TodoVersion` in
  dispatch envelopes, and the parent-cannot-edit-child invariant.
- [ ] T031 Extend `packages/opencode/src/agent/agent.ts` for specialist-agent
  resolution via AgentV2 in the two-stage pipeline, and extend
  `packages/opencode/src/event-v2-bridge.ts` to bridge the new routing,
  hierarchy, and capability events onto the EventV2 bus.

### CLI and TUI surfaces (Phase 1 and Phase 2)

- [ ] T032 Add the CLI commands under `packages/cli/src/telemetry/` for
  `telemetry status|on|off|test|show|configure`, each dispatching through the
  Feature 007 registry with zero model calls and redacted secret output.
- [ ] T033 Add the CLI commands under `packages/cli/src/smart/` and
  `packages/cli/src/routing/` for `smart status|on|off|auto` and `routing
  status|explain|test|capability inspect`; `routing test` runs a deterministic
  local simulation reporting "no external model call was made".
- [ ] T034 Add the TUI Smart-state surface under `packages/tui/src/smart/` and
  `packages/tui/src/routing-state/` consuming `SmartIndicatorStateSchema`.
- [ ] T035 Wire the Smart indicator in
  `packages/tui/src/component/prompt/index.tsx` at the
  `Locale.titlecase(agent().name)` label: render `Smart` in `theme.error` when
  brain mode and Smart Routing are both active, render the fallback text when
  either is inactive, keep it text plus theme-aware and never color-only, and
  re-evaluate on every render.

### Tests and validation

- [ ] T036 Add unit tests (pure, deterministic, no I/O) for the classifier,
  capability resolver, routing evaluator hard gates and ranking, budget policy,
  todo authority, hierarchy dispatcher, and telemetry instruments.
- [ ] T037 Add integration tests through the Feature 007 sandbox wrapper for
  TelemetryPort with a mock OTLP exporter, RoutingPort with the catalog adapter,
  Config.Service and EventV2 adapters, and decision-store persistence with the
  atomic-commit and crash-recovery paths, using real files under `.dev/`.
- [ ] T038 Add contract tests asserting the `smart.*`, `routing.*`, and
  `telemetry.*` command IDs against the Feature 007 registry and the loopback API
  against `contracts/ports.ts`, plus a cardinality audit asserting no
  session/message/dynamic-skill IDs appear in metric labels.
- [ ] T039 Add end-to-end tests through the sandbox wrapper for the CLI (human
  and JSON output), the slash intercept, the Settings path, and the Smart TUI
  indicator, confirming content-free OTEL labels.

## Dependencies

**Sequencing (internal):**

- T001–T008 (schema and protocol) precede every implementation task; T002
  precedes T003 (budget referenced by routing config) and T004 (budget snapshot
  in the decision record).
- Telemetry: T009 → T010 → T011 → T012 → T013 → T014.
- Routing domain: T015–T016 → T017 → T018 → T019 → T020; T021 depends on T017;
  T022 precedes T023; T023 depends on T022 and T024; T024 precedes T030.
- Application and adapters (T026–T031) depend on the routing domain (T015–T025)
  and the schemas (T001–T008); T028 depends on T026.
- CLI and TUI (T032–T035) depend on the ports and services (T013, T026); T035
  depends on T007 and T034.
- Tests (T036–T039) depend on their corresponding implementation tasks; T037–T039
  run only through the Feature 007 sandbox wrapper.

**External dependencies (must be available or accepted first):**

- ADR-0001 (telemetry foundation) accepted before Phase 1 tasks (T009–T014) are
  relied upon in production.
- ADR-0002 (core smart routing) accepted before Phase 2 tasks (T015 onward).
- ADR-0003 (operator control plane) accepted — Feature 007 registry, dispatcher,
  Config.Service, SecretPort, EventV2 bus, and sandbox wrapper are the sole
  management authority and the only path for command registration and secret
  storage.
- Existing canonical services reused, not re-created: Catalog.Service and
  ModelsDev (candidate resolution), SessionRunnerModel (executor resolution),
  AgentV2 (agent resolution), SkillV2 (skill selection), PermissionV2 and Policy
  (hard gates), and the Session and Task lifecycle.
- Feature 006 Milvus Semantic retrieval consumes `retrieval_top_k`,
  `rerank_top_k`, and `max_skill_chunks` from the Budget policy (T022) and does
  not own hard gates or final route selection.
- The `.dev/opencode-operator/` sandbox root, `OPENCODE_DEV_OPERATOR_=1` env
  prefix, and loopback port 14096 are provisioned before integration and e2e
  tests (T037–T039) run.
