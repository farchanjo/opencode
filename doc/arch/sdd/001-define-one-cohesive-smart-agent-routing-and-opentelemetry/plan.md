# Implementation Plan: Smart Agent Routing and Telemetry Foundation (Feature 001)

Feature: 001-define-one-cohesive-smart-agent-routing-and-opentelemetry
Status target: planned (after this plan is complete)
ADR-0001: proposed (telemetry foundation — must be accepted before Phase 2 rely)
ADR-0002: proposed (routing hierarchy — must be accepted before Phase 2 rely)
ADR-0003: **accepted** (operator control plane — sole management authority)
Spec: [spec.md](spec.md) (status: clarified; phase gate in spec §Clarification Questions)
Research: [research.md](research.md)

---

## Overview

Feature 001 delivers two dependent phases on the `fcustom` branch:

- **Phase 1 (Telemetry Foundation):** OpenTelemetry instrumentation, persistent OTLP
  configuration via Feature 007 operator control plane, bounded async export, and
  privacy redaction. ADR-0001 governs instrumentation, transport, cardinality, and
  offline behavior. This phase is additive and non-breaking; telemetry is disabled
  until explicitly configured.
- **Phase 2 (Smart Agent Routing):** Core hierarchical adaptive routing with
  Architect → Manager → Worker roles, two-stage task→agent→model selection, tool
  capability hard gates, deterministic fallback, session-owned Todo, Context/Turn
  and Delegation Budget, and correlated observability. ADR-0002 governs placement,
  hierarchy, routing constraints, and Todo authority. Depends on Phase 1 and
  ADR-0001 acceptance.

**Management authority for both phases** is Feature 007 Operator Control Plane
(ADR-0003, accepted). All setup, configuration, and operator commands use
`smart.*`, `routing.*`, `telemetry.*`, `budget.*`, `pools.*` command IDs registered
via Feature 007 registry. LLM, brain, plugin, MCP, and ToolRegistry paths never
hold management authority.

**Not in this plan:** implementation code (implement phase later), App/Desktop parity
(Phase 2), multi-user RBAC, non-loopback operator API.

---

## Non-goals

- Implementing code during the plan phase.
- Accepting ADR-0001 / ADR-0002 (remain proposed; plan/tasks are documentary only).
- Editing `~/.config/opencode` or production processes outside sandbox harness.
- Creating a parallel runtime, catalog, resolver, registry, schema/event identity,
  execution loop, `smart_task`, or retry controller.
- Hardcoding model/provider IDs as role identity.
- Allowing Manager-of-Manager or Worker-of-Worker recursion.
- Using unbounded fanout concurrency.
- Permitting Architect/Manager project mutation under orchestration-only policy.
- Using shared parent/child Todo lists.
- Bypassing hard gates with brain proposals or model recommendations.
- Raw secrets in command arguments, shell history, slash prompts, or output.
- Treating operator commands as prompts, Message/Part entries, custom templates,
  tools, MCP calls, or model interfaces.

---

## Technical Approach

### Architecture layers

```
Adapters (inbound) — Feature 007 thin adapters
  TUI Settings / palette / native slash
  CLI opencode smart|routing|telemetry|...
  Internal loopback HTTP API / SDK
        |
        v
Application (Feature 001 domain — ports owned by this feature)
  TelemetryPort          — configure, status, test, export/flush
  RoutingPort            — evaluate, explain, test, capability inspect
  SmartPort              — status, on, off, auto
  BudgetPort             — read/observe budget consumption
  PoolsPort              — read role pool configuration
  RoutingDecisionStore   — persist, replay, atomic commit
  TelemetryExportQueue   — bounded async OTLP export
        |
        v
Domain (Feature 001 core — zero framework deps)
  RoutingEvaluator       — hard gates, ranking, decision model, fallback
  Classifier             — task size/complexity → direct_worker | manager path
  CapabilityResolver     — tool-call dimensions, metadata, override, observation
  BudgetPolicy           — Context, Turn and Delegation Budget enforcement
  TodoAuthority          — session-owned Todo aggregate, snapshot, completion gate
  HierarchyDispatcher    — Architect → Manager → Worker dispatch envelopes
  TelemetryInstruments   — spans, metrics, logs, bounded cardinality
        |
        v
Outbound adapters
  Config.Service adapter (existing — via Feature 007)
  EventV2 adapter (existing — via Feature 007)
  Catalog.Service / ModelsDev (existing — canonical candidate resolution)
  SessionRunnerModel (existing — final model resolution)
  AgentV2 (existing — agent resolution)
  SkillV2 (existing — skill resolution)
  PermissionV2 / Policy (existing — authorization)
  SessionRunner / Task lifecycle (existing — execution)
  EventV2 event bus (existing — correlation)
  OTLP exporter (new — packages/core/src/observability/otlp.ts extension)
  Secure storage (existing — via Feature 007 SecretPort)
```

Dependency rule: adapters → application → domain. Domain MUST NOT import TUI/CLI/HTTP
frameworks. Composition root wires concrete adapters.

### Packages and modules (as-is reuse, no parallel stores)

| Concern               | Existing location (reuse)                                                                       | Feature 001 addition                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OTEL SDK + OTLP       | `packages/core/src/observability/otlp.ts`                                                       | Extend for metrics, logs, bounded queue, privacy redaction                                                                                                                  |
| Telemetry instruments | `packages/core/src/observability/`                                                              | New `telemetry-instruments.ts` (spans, metrics, logs)                                                                                                                       |
| Config authority      | `packages/opencode/src/config/config.ts` (`Config.Service`)                                     | Telemetry config + routing config via Feature 007 ports                                                                                                                     |
| Events / audit        | core EventV2 + `packages/opencode/src/event-v2-bridge.ts`                                       | RoutingDecision\* events, hierarchy events, capability events                                                                                                               |
| Candidate catalog     | `packages/core/src/catalog.ts`, `packages/core/src/models-dev.ts`                               | Routing candidates from Catalog.Service/ModelsDev only                                                                                                                      |
| Session model         | `packages/opencode/src/session/llm.ts`                                                          | SessionRunnerModel reuse for executor resolution                                                                                                                            |
| Agent                 | `packages/core/src/agent.ts`                                                                    | AgentV2 reuse for specialist agent resolution                                                                                                                               |
| Skills                | `packages/core/src/skill.ts`                                                                    | SkillV2 reuse for skill selection                                                                                                                                           |
| Permissions           | `packages/core/src/permission.ts`, `packages/opencode/src/permission/`                          | PermissionV2/Policy for hard gates                                                                                                                                          |
| Session / Task        | `packages/opencode/src/session/session.ts`, `packages/opencode/src/session/`                    | Session lifecycle reuse; new routing-aware session state                                                                                                                    |
| Todo                  | `packages/opencode/src/session/todo.ts`                                                         | Extend for session-owned aggregate, snapshot, completion gate                                                                                                               |
| Routing evaluation    | `packages/llm/src/route/` (HTTP transport layer for provider calls, not Smart Routing decision) | New `packages/opencode/src/routing/` module (novo)                                                                                                                          |
| Tool capabilities     | `packages/llm/src/tool-runtime.ts`, provider metadata                                           | New `CapabilityResolver` (novo) using canonical metadata                                                                                                                    |
| Schema / Protocol     | `packages/schema`, `packages/protocol`                                                          | Routing decision schema (novo), command payload schemas (novo)                                                                                                              |
| Operator registry     | `packages/opencode/src/operator/` (Feature 007)                                                 | Register `smart.*`, `routing.*`, `telemetry.*` via Feature 007 ports                                                                                                        |
| TUI                   | `packages/tui/src/component/prompt/index.tsx:1546-1577`                                         | Smart label (`Locale.titlecase(agent().name)` → "Smart" in red via `theme.error`) conditional on brain mode + Smart Routing both active; fallback text when either inactive |
| CLI                   | `packages/cli`, `packages/opencode/src/cli`                                                     | `opencode smart\|routing\|telemetry ...` commands                                                                                                                           |
| Server HTTP           | `packages/server`, `packages/opencode/src/server`                                               | Loopback operator routes for telemetry/routing                                                                                                                              |
| SDK                   | `packages/sdk`, `packages/sdk-next`, `packages/client`                                          | Typed operator client for telemetry/routing                                                                                                                                 |

**New module tree target:**

```
packages/core/src/observability/
  otlp.ts                    # existing — extend for Phase 1 metrics/logs/bounded queue
  shared.ts                  # existing
  logging.ts                 # existing
  telemetry-instruments.ts   # novo — spans, metrics, logs, bounded cardinality labels
packages/opencode/src/routing/
  index.ts                   # barrel
  domain/
    routing-evaluator.ts     # hard gates, ranking, decision model, fallback
    classifier.ts            # task size/complexity → direct_worker | manager
    capability-resolver.ts   # tool-call dimensions: presence, calls-per-turn, parallel, continuation
    budget-policy.ts         # Context, Turn and Delegation Budget enforcement
    hierarchy-dispatcher.ts  # Architect → Manager → Worker dispatch envelopes
    routing-decision.ts      # immutable decision record schema + persistence
    todo-authority.ts        # session-owned Todo aggregate, snapshot, completion gate
    errors.ts                # typed routing errors
  application/
    ports.ts                 # RoutingPort, TelemetryPort, SmartPort, BudgetPort, PoolsPort
    routing-service.ts       # orchestrates domain + ports
    telemetry-service.ts     # OTLP config, queue, export, privacy redaction
  adapters/
    inbound/                 # routing commands via Feature 007 dispatcher
    outbound/
      catalog-adapter.ts     # Catalog.Service candidate resolution
      config-adapter.ts      # Config.Service telemetry/routing config
      event-adapter.ts       # EventV2 routing/hierarchy/capability events
      otlp-adapter.ts        # OTLP exporter adapter
packages/opencode/src/session/
  todo.ts                    # existing — extend with session-owned aggregate + snapshot
  routing-state.ts           # novo — routing decision ref, hierarchy role, budget consumption
packages/opencode/src/agent/
  agent.ts                   # existing — AgentV2 reuse
packages/opencode/src/operator/
  (Feature 007 existing — register smart.*/routing.*/telemetry.* here)
```

---

## Incremental Phase 1 + Phase 2 slices

| Slice | Name                            | Delivers                                                                                                                                                                                                                                                                                                                                  | Depends            |
| ----- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --- | ---------------------- | ------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| S0    | OTEL foundation extensions      | Extend `packages/core/src/observability/otlp.ts` for metrics + structured logs + bounded queue + privacy redaction; align with ADR-0001 cardinality rules                                                                                                                                                                                 | —                  |
| S1    | Telemetry configuration + queue | TelemetryPort; Settings-persisted OTLP config; async bounded export queue; drop/backpressure policy; queue depth/capacity/drop signals                                                                                                                                                                                                    | S0                 |
| S2    | Telemetry privacy + redaction   | Default redaction of prompts, secrets, personal paths, file content, tool payloads; configurable signal-level enablement; connection test without user content export                                                                                                                                                                     | S1                 |
| S3    | Telemetry command surface       | `telemetry.status`, `telemetry on`, `telemetry off`, `telemetry test`, `telemetry show`, `telemetry configure` via Feature 007 registry; zero LLM calls; offline-capable status                                                                                                                                                           | S2, F007           |
| S4    | Telemetry observability         | Spans: `routing.evaluate`, `decision_model`, `hard_gates`, `rank`, `task.execute`, `llm.request`, `tool.execute`, `fallback`; metrics: routing decision latency, hard-gate rejection count, authorized-candidate count, queue depth, export drops, exporter errors; hierarchy role, fanout, validation in traces/logs                     | S0–S3              |
| S5    | Routing domain model            | RoutingEvaluator, Classifier, RoutingDecision record schema, immutable decision fields (task class, routing_profile, task_effort, reasoning_effort, provider_variant, budgets, catalog/policy versions, evidence refs, auth context, execution boundary, fallback state)                                                                  | S4 (observability) |
| S6    | CapabilityResolver              | Tool-call capability dimensions: presence, calls-per-turn, same-turn multiple-call, serial runner execution, parallel calls, continuation, multi-turn cycles; declared metadata from canonical provider/model; validated override overlay with source/confidence/TTL; conservative unknown policy                                         | S5                 |
| S7    | Hard gates + ranking            | Deterministic hard-gate evaluation per capability dimension; model decisor recommendation among authorized candidates only; deterministic tie-break; two-stage pipeline: task → specialist agent → executor model; skill + effort dimensions                                                                                              | S5–S6              |
| S8    | Fallback + mutation boundary    | Fallback classifies execution boundary (safe/retryable/mutation-risky); authorized candidates only; no blind mutation repeat; explicit no-authorized-candidate error; decision atomicity (crash before commit → no partial; crash after → exactly-once recovery)                                                                          | S7                 |
| S9    | Hierarchical routing            | Architect main context role from user-configured role pool at frontier tier; direct Worker path for small/bounded; Manager path for complex/decomposable; max depth Architect → Manager → Worker; orchestration-only Architect/Manager; validation chain; fanout under admission; escalation reuse evidence/OutputRefs/lineage            | S7–S8              |
| S10   | Mandatory session-owned Todo    | Every goal-bearing Architect/Manager/Worker Session owns exactly one Todo aggregate; non-empty snapshot before execution; completion gate; durable snapshot outside message prose; rehydration after compaction/restart; TodoRef/version in dispatch envelopes                                                                            | S9                 |
| S11   | Budget policy                   | Context, Turn and Delegation Budget: `max_turns`, `max_context_tokens/bytes`, `max_output_tokens/bytes`, `max_workers`, `max_delegation_depth`, `retrieval_top_k`, `rerank_top_k`, `max_skill_chunks`, time/cost/token budgets, retry/validation depth, escalation thresholds; hard maximums; explicit blocked/escalation/error on exceed | S9–S10             |
| S12   | Routing command surface         | `smart status                                                                                                                                                                                                                                                                                                                             | on                 | off | auto`, `routing status | explain | test | capability inspect`via Feature 007 registry;`routing test` is deterministic local simulation (zero model calls); redact secrets/prompts/reasoning in all output | S9, F007 |
| S13   | Smart UI indicator              | TUI conditional label at `Locale.titlecase(agent().name)` (prompt/index.tsx:1550): when brain mode + Smart Routing both active → show `Smart` in `theme.error` (red); when either inactive → fallback text visible; text + theme-aware + monochrome; never color-only                                                                     | S12                |
| S14   | Persistence + replay            | RoutingDecision persisted atomically + idempotently; catalog version mismatch detection; replay preserves authorization + catalog version; re-resolution under current policy on mismatch; crash recovery: partial unusable, committed recoverable                                                                                        | S8                 |
| S15   | Feature 002/006 alignment       | Hierarchy telemetry for Event Bus/Process Table; `parent_session_id == current_session_id` direct-child Session UI; OutputSpool refs for bounded context; Feature 006 retrieval budgets consumed from Budget policy                                                                                                                       | S9–S11             |
| S16   | Tests + validation              | Unit (domain pure logic), integration (Testcontainers if DB), contract (OpenAPI/AIL against command surface), e2e (sandbox harness); content-free OTEL labels; cardinality audit                                                                                                                                                          | all slices         |

**Phase 1 = S0–S4 + S16 partial.** Telemetry is additive and disabled until configured.
Phase 1 does not change existing prompt, Task, provider, plugin, permission, or
settings behavior.

**Phase 2 = S5–S16.** Routing introduces the core seam and domain operator surfaces.
Phase 2 management authority remains Feature 007 Phase 1. Existing plugin paths
remain compatible and are not silently promoted.

---

## Data model and persistence strategy

### Telemetry configuration (Phase 1)

OTLP settings persisted via Config.Service under Feature 007 operator control plane:

```
telemetry.enabled: boolean
telemetry.endpoint: string
telemetry.transport: "http/protobuf" | "grpc"
telemetry.headers: Record<string, SecretRef>
telemetry.tls.enabled: boolean
telemetry.tls.cert: SecretRef
telemetry.signals.metrics: boolean
telemetry.signals.logs: boolean
telemetry.signals.traces: boolean
telemetry.signals.profiling: boolean
telemetry.queue.capacity: number
telemetry.queue.batch_size: number
telemetry.queue.enqueue_timeout_ms: number
telemetry.queue.export_timeout_ms: number
telemetry.queue.retry_budget: number
telemetry.queue.drop_policy: "drop" | "backpressure"
telemetry.redact.prompts: boolean
telemetry.redact.secrets: boolean
telemetry.redact.file_paths: boolean
telemetry.redact.tool_payloads: boolean
telemetry.resource.attributes: Record<string, string>
telemetry.sampling: number  # 0.0–1.0
```

Secrets stored via Feature 007 SecretPort (OS keychain), never plaintext.
Settings validated before activation; connection test emits a clearly-marked
test signal without exporting user content.

### Routing configuration (Phase 2)

Routing config persisted via Config.Service under Feature 007 operator control plane:

```
routing.enabled: boolean
routing.mode: "always" | "auto" | "never"
routing.strict_gates: boolean
routing.decision_model.pool: string[]           # role pool IDs for decision model
routing.role_pools: Record<RolePoolID, ModelID[]>
  # RolePoolID examples: "architect", "manager", "worker-fast-large", "worker-fast-small"
routing.fallback.floor_role: RolePoolID
routing.capability.metadata_source: "catalog" | "override" | "observed"
routing.capability.unknown_policy: "deny" | "allow"
routing.capability.probing_enabled: boolean
routing.budget: BudgetPolicy  # inline or reference
routing.hierarchy.max_depth: 2  # Architect → Manager → Worker = depth 2
routing.hierarchy.orchestration_only: boolean
```

**No hardcoded model/provider IDs.** Role pool values resolve from canonical
Catalog.Service/ModelsDev at routing time. Product policy uses tier abstractions only.

### Routing decision record (Phase 2)

Immutable record persisted to local store (SQLite page with journaling for atomicity):

```typescript
interface RoutingDecision {
  readonly id: string // ULID
  readonly version: number // schema version for replay compatibility
  readonly session_id: string
  readonly turn_id: string
  readonly task_fingerprint: string // deterministic hash of task inputs for cache

  // Task classification
  readonly task_class: TaskClass // "small" | "medium" | "large" | "complex"
  readonly routing_profile: RoutingProfile
  readonly task_effort: TaskEffort
  readonly reasoning_effort: ReasoningEffort

  // Two-stage pipeline
  readonly specialist_agent: AgentID
  readonly executor_model: ModelID
  readonly selected_skills: ReadonlyArray<SkillID>
  readonly provider_variant: string

  // Hard gates
  readonly gates: ReadonlyArray<GateResult> // pass/fail per dimension + reason

  // Decision model (if called)
  readonly decision_model_id: ModelID | null
  readonly decision_inputs: unknown | null // structured inputs, no raw prompts
  readonly decision_output: unknown | null

  // Ranking
  readonly candidates: ReadonlyArray<CandidateRecord>
  readonly ranking: ReadonlyArray<RankedCandidate>
  readonly tie_break: string | null

  // Budget applied
  readonly budget: BudgetPolicySnapshot
  readonly budget_consumed: BudgetConsumption

  // Catalog/policy versions at decision time
  readonly catalog_version: string
  readonly policy_version: string

  // Authorization context
  readonly auth_context: AuthContextSnapshot

  // Execution boundary
  readonly execution_boundary: ExecutionBoundary // "safe" | "retryable" | "mutation_risky"

  // Fallback state
  readonly fallback_attempted: boolean
  readonly fallback_reason: string | null
  readonly fallback_candidates: ReadonlyArray<ModelID> | null

  // Metadata
  readonly created_at: string // ISO 8601
  readonly decision_latency_ms: number
  readonly offline: boolean // true if remote metrics unavailable at decision time
}
```

**Atomic commit protocol:**

1. Write record to temp page.
2. Journal commit flag.
3. Atomic rename to final page.
   Crash before step 2 → temp page ignored (no partial). Crash after step 2 → record
   recoverable. Idempotency key: `(session_id, turn_id, task_fingerprint)`.

**Catalog version mismatch on replay:**

- Original record remains unchanged.
- System either replays under recorded catalog (authorized candidates still valid)
  or emits explicit `catalog_mismatch` + `re_resolved` outcome.
- Explicit `unavailable_candidate` error if no authorized candidate remains.

### Tool capability record (Phase 2)

```typescript
interface CapabilityRecord {
  readonly provider: ProviderID
  readonly model: ModelID
  readonly variant: string
  readonly api: string // normalized API family

  readonly dimensions: {
    readonly tool_call_present: boolean | null // null = unknown
    readonly max_calls_per_turn: number | null
    readonly same_turn_multiple_calls: boolean | null
    readonly serial_runner_execution: boolean | null
    readonly parallel_calls: boolean | null
    readonly continuation_after_tool_result: boolean | null
    readonly multi_turn_cycles: boolean | null
  }

  readonly source: "catalog" | "override" | "observed"
  readonly confidence: number // 0.0–1.0
  readonly timestamp: string // ISO 8601
  readonly ttl_ms: number
  readonly scope: string // provider/model/variant/API
}
```

---

## API and command contracts

All commands registered via Feature 007 Operator Control Plane registry.
Canonical dotted IDs; surface aliases generated by `generateAliases`. No parallel
registry. Command input parsed + dispatched locally before prompt admission.

### Smart surface

| Palette/slash ID | CLI                                             | Description                                                                          | Model calls | Cost |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ | ----------- | ---- |
| `smart.status`   | `opencode smart status`                         | Effective state, origin, availability, brain/router info, health, recommended action | 0           | 0    |
| `smart.on`       | `opencode smart on [--scope global\|project]`   | Enable Smart mode                                                                    | 0           | 0    |
| `smart.off`      | `opencode smart off [--scope global\|project]`  | Disable Smart mode                                                                   | 0           | 0    |
| `smart.auto`     | `opencode smart auto [--scope global\|project]` | Policy-driven activation (distinct from permission-mode `auto`)                      | 0           | 0    |

### Routing surface

| Palette/slash ID             | CLI                                                        | Description                                                                                       | Model calls | Cost |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------- | ---- |
| `routing.status`             | `opencode routing status`                                  | Effective routing config, enabled state, decision model pool health                               | 0           | 0    |
| `routing.explain`            | `opencode routing explain <decision-id>`                   | Redacted gates, candidates/rejections, score breakdown, decision/fallback, confidence             | 0           | 0    |
| `routing.test`               | `opencode routing test [--input <task-description>]`       | Deterministic local simulation; zero model calls; zero mutations; report: "no external call made" | 0           | 0    |
| `routing.capability.inspect` | `opencode routing capability inspect [--model <model-id>]` | Redacted declared + observed single-tool capability metadata                                      | 0           | 0    |

**`routing test` is a dry run:** reads persisted decision data + canonical metadata,
runs deterministic local simulation of hard gates + ranking, executes no tool or
mutation, calls zero decision/executor/provider model, consumes zero tokens, incurs
zero cost. A future provider/model diagnostic command MUST use a separate explicit
name with consent + cost disclosure and MUST NOT be reported as this baseline.

### Telemetry surface

| Palette/slash ID      | CLI                                                      | Description                                                                                     | Model calls | Cost |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------- | ---- |
| `telemetry.status`    | `opencode telemetry status`                              | Enabled state, effective config, endpoint, transport, signal status, export health, queue depth | 0           | 0    |
| `telemetry.on`        | `opencode telemetry on [--scope global\|project]`        | Enable telemetry                                                                                | 0           | 0    |
| `telemetry.off`       | `opencode telemetry off [--scope global\|project]`       | Disable telemetry                                                                               | 0           | 0    |
| `telemetry.test`      | `opencode telemetry test [--mode signal\|connectivity]`  | Emit clearly-marked test signal OR validate connectivity; no user content export                | 0           | 0    |
| `telemetry.show`      | `opencode telemetry show`                                | Current effective configuration (redacted secrets)                                              | 0           | 0    |
| `telemetry.configure` | `opencode telemetry configure [--scope global\|project]` | Open persistent Settings flow; never accept raw secrets in prompt/slash                         | 0           | 0    |

### Budget surface (read-only observation)

| Palette/slash ID | CLI                                                 | Description                                                      |
| ---------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `budget.status`  | `opencode budget status [--scope session\|project]` | Effective budget policy, consumption to date, remaining headroom |
| `budget.limits`  | `opencode budget limits`                            | Hard maximums per scope/profile/role                             |

### Pools surface (read-only observation)

| Palette/slash ID | CLI                                                       | Description                                               |
| ---------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `pools.list`     | `opencode pools list [--role architect\|manager\|worker]` | Configured role pools, candidate counts, catalog versions |
| `pools.show`     | `opencode pools show <pool-id>`                           | Pool members, health, tier                                |

**All status/show commands work offline, with no configured model/provider, and when
all routing candidates fail. Zero LLM calls, zero model tokens, zero model cost.**

---

## State machines

### Telemetry enablement

```
disabled → validating → enabled
         ↘ validation_failed → disabled
enabled → exporting → degraded (queue full / transport error) → enabled
                     ↘ disabled (explicit off)
```

### Routing decision flow

```
task_input → classify (task class + complexity signals)
  → hard_gates (capability dimensions × authorized candidates)
  → filter (authorized only)
  → decision_model (if policy requires)
  → rank (deterministic scoring + tie-break)
  → select (top ranked)
  → persist (atomic commit)
  → dispatch (Architect | Manager | Worker)
  → monitor (fallback on failure)
```

### Hierarchy dispatch

```
Architect.classify(task)
  → direct_worker: Architect → Worker → Architect.validate
  → manager: Architect → Manager → [Manager → Worker]×N → Manager.validate → Architect.validate
```

### Fallback flow

```
execution_boundary_classified(task, candidate, error)
  → safe: retry same candidate
  → retryable: retry authorized compatible candidate
  → mutation_risky: do NOT retry; emit explicit error
```

---

## Security and threat boundaries

| Threat                              | Mitigation                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| LLM/tool as routing admin           | No `smart.*`/`routing.*`/`telemetry.*` in ToolRegistry; slash pre-prompt intercept    |
| Brain proposal bypassing gates      | Router core validates; hard gates are authoritative; proposal recorded + rejected     |
| Secret leakage in config/commands   | SecretPort (OS keychain); no plaintext secrets in JSON/config/args/output             |
| Raw secrets in command history      | Command parser rejects secrets in args; shell history exclusion; output redaction     |
| Catalog version confusion on replay | Immutable record with version; mismatch → explicit re-resolution; never silent replay |
| Mutation boundary bypass            | Fallback classifies boundary; mutation-risky → no blind retry                         |
| Unauthorized permission elevation   | PermissionV2/Policy gates precede routing; role fallback floors enforced              |
| High-cardinality metric labels      | Bounded enums/buckets; allowlisted catalog IDs under budget; `other` mapping          |
| Escalation discarding work          | Evidence + OutputRefs + TodoRef + process lineage reused on reclassification          |
| Architect below minimum tier        | Explicit authorization required; fallback floor enforced                              |
| Cross-session Todo leak             | Each Session owns exactly one Todo aggregate; no shared lists                         |
| Parent editing child Todo           | Dispatch envelopes carry read-only TodoRef/version/summary; parent cannot edit child  |

---

## Rollback strategy

| Layer                           | Rollback                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| Telemetry config                | Config.Service snapshot restore (10 snapshots / 30 days)                                     |
| Routing enabled state           | `routing.off` command; Feature 007 atomic rollback                                           |
| Role pool misconfiguration      | Operator edits pools via `pools.*` commands; atomic CAS                                      |
| Catalog version mismatch        | Replay under recorded catalog OR explicit re-resolution; no silent fallback                  |
| Fallback loop                   | Circuit breaker with explicit `mutation_risky` classification; counter + threshold           |
| Telemetry queue overflow        | Drop/backpressure policy applied; queue depth metric emitted; no blocking                    |
| Exporter failure                | Offline mode; cached config; degradation status visible; export resumes on reconnect         |
| Routing decision partial commit | Crash before commit leaves no usable record; crash after commit allows exactly-once recovery |
| Smart indicator stuck active    | TUI re-evaluates brain mode + routing active on every render; explicit fallback state        |

---

## Isolation harness

Routing and telemetry development uses the existing Feature 007 isolation harness:

| Item         | Value                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| Sandbox root | `.dev/opencode-operator/` (gitignored)                                          |
| Env prefix   | `OPENCODE_DEV_OPERATOR_=1`, `OPENCODE_CONFIG_DIR=.dev/opencode-operator/config` |
| Port         | **14096** (loopback)                                                            |
| Wrapper      | `scripts/dev/opencode-operator-sandbox`                                         |
| Forbidden    | `~/.config/opencode`, system service register, real OAuth, non-loopback bind    |
| Proof tests  | Assert default config paths and prod ports unchanged when wrapper not used      |

All Feature 001 development and tests for operator surfaces MUST go through the
sandbox wrapper. Hot-path routing logic (without operator UI) may run in-process
with mock Feature 007 ports.

---

## Testing matrix

| Layer       | Scope                                                                                                                                           | How                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Unit        | Domain VOs, RoutingEvaluator, Classifier, CapabilityResolver, BudgetPolicy, TodoAuthority, HierarchyDispatcher; OTEL instruments                | Pure tests; no I/O; deterministic                                   |
| Integration | TelemetryPort + OTLP adapter (mock exporter), RoutingPort + catalog adapter, Config.Service adapter, EventV2 adapter, DecisionStore persistence | Real local stores under `.dev/`; Testcontainers only if DB required |
| Contract    | `smart.*`/`routing.*`/`telemetry.*` command IDs vs Feature 007 registry; OpenAPI for loopback API                                               | Spec-driven; specScopeGlobs enforced                                |
| E2E         | CLI human + JSON; slash intercept; Settings path (headless where possible); Smart TUI indicator                                                 | Sandbox wrapper only                                                |
| Capability  | CapabilityResolver against declared metadata, override, observed overlay                                                                        | Fixture-based; no live provider calls                               |
| Fallback    | Mutation boundary classification, authorized-only retry, no-blind-repeat                                                                        | Unit + integration with mock executor                               |
| Hierarchy   | Architect → Manager → Worker dispatch, validation chain, escalation, Todo snapshot                                                              | Unit with mock dispatcher; integration with real Session lifecycle  |

**No mocking of Config/Event durability in integration tests; use sandbox files/DB.**
Cardinality audit: assert no session/message/dynamic-skill IDs in metric labels.

---

## Observability alignment

- OTEL instruments follow `effect/opentelemetry` conventions already used in
  `packages/core/src/observability/otlp.ts`.
- Metric labels use bounded enums: `status` (success/failure/blocked/degraded),
  `task_class` (small/medium/large/complex), `routing_profile`, `effort`,
  `capability`, `reason`; `provider`/`model`/`variant`/`agent` use only active
  allowlisted IDs under configurable cardinality budget; over-budget maps to `other`
  - counter.
- API family normalized (e.g., `openai`, `anthropic`, `openai-compatible`).
- Detailed skills and dynamic IDs retained in traces/logs, not metric labels.
- Session/message identifiers are trace data/links/opaque attributes, never metric
  labels.
- Concept spans: `routing.evaluate`, `decision_model`, `hard_gates`, `rank`,
  `task.execute`, `llm.request`, `tool.execute`, `fallback`.
- Hierarchy spans/logs: Architect classification, brain negotiation, route proposal,
  accepted/rejected recommendation, re-route, hierarchy role (`architect`|`manager`|
  `worker`), delegation depth/path, fanout requested/granted, dispatched
  Manager/Worker, validation state at each level, result.
- Local metrics store authoritative for router hot path; OTLP export async and
  bounded.
- Command telemetry: canonical operation ID, source (palette/slash/CLI/Settings),
  actor, scope, action, result, config version, outcome classification (unavailable
  vs execution failure), recommended action.

---

## specScopeGlobs (applied and verified in doc/arch/speckit.toml)

Narrow paths only. Feature 007 paths in the TOML are preserved unchanged.
The inline list below is the authoritative Feature 001 edit scope; Feature 007
TOML paths (`packages/opencode/src/operator/**`, etc.) already cover the
operator port areas and are not duplicated here.

```toml
specScopeGlobs = [
  # Feature 001 — Smart Agent Routing and Telemetry.
  # Existing paths (extended):
  "packages/core/src/observability/telemetry-instruments.ts",  # novo
  "packages/core/src/observability/otlp.ts",                   # existing — extended
  "packages/opencode/src/routing/**",                          # novo
  "packages/opencode/src/session/routing-state.ts",            # novo
  "packages/opencode/src/session/todo.ts",                     # existing — extended
  "packages/cli/src/**/smart/**",                              # novo
  "packages/cli/src/**/routing/**",                            # novo
  "packages/cli/src/**/telemetry/**",                          # novo
  "packages/tui/src/**/smart/**",                              # novo
  "packages/tui/src/**/routing-state/**",                      # novo
  "packages/tui/src/component/prompt/index.tsx",               # S13/FR30 smart indicator
  "packages/schema/src/**/routing/**",                         # novo
  "packages/schema/src/**/telemetry/**",                       # novo
  "packages/protocol/src/**/routing/**",                       # novo
  "packages/protocol/src/**/telemetry/**",                     # novo
  "packages/opencode/src/agent/agent.ts",                      # existing — extended
  "packages/opencode/src/event-v2-bridge.ts",                  # existing — extended
  "doc/arch/sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/**",
  "doc/arch/adr/0001-opentelemetry-telemetry-foundation.md",
  "doc/arch/adr/0002-core-smart-agent-routing.md",
]
```

---

## Companion artifacts

| File                       | Purpose                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------- |
| [research.md](research.md) | Evidence and closed clarify package                                                 |
| [spec.md](spec.md)         | Feature specification (clarified)                                                   |
| `data-model.md` (novo)     | Entity definitions: RoutingDecision, CapabilityRecord, BudgetPolicy, Todo aggregate |
| `contracts/` (novo)        | TypeScript interface contracts for ports, command payloads, event schemas           |
| `hierarchy-flow.md` (novo) | Mermaid diagram: Architect/Manager/Worker dispatch, validation chain, budget flow   |

---

## Implementation order (task groups preview)

Phase 1 (telemetry-first, additive, non-breaking):

1. Extend `packages/core/src/observability/otlp.ts` for metrics + structured logs.
2. Add `telemetry-instruments.ts` with bounded cardinality spans/metrics/logs.
3. Implement TelemetryPort + bounded async export queue + drop/backpressure policy.
4. Implement privacy redaction defaults + signal-level enablement.
5. Register `telemetry.*` commands via Feature 007.
6. `telemetry test` emits clearly-marked signal or validates connectivity.
7. Observability: spans `routing.evaluate`–`fallback`, metrics: routing decision
   latency, hard-gate rejection count, authorized-candidate count, queue depth,
   export drops, exporter errors.
8. Unit + integration tests for Phase 1.

Phase 2 (routing, requires ADR-0001 + ADR-0002 acceptance): 9. Routing domain model: RoutingEvaluator, Classifier, RoutingDecision record. 10. CapabilityResolver: tool-call dimensions, declared metadata, override, observation. 11. Hard gates + ranking: deterministic gate evaluation per capability dimension,
two-stage pipeline (task → specialist agent → executor model), skill + effort. 12. Fallback + mutation boundary: authorized-only retry, mutation-risky classification,
explicit no-authorized-candidate error, atomic decision persistence. 13. Hierarchical routing: Architect main context, direct Worker / Manager paths,
max depth, orchestration-only roles, validation chain, fanout under admission. 14. Mandatory session-owned Todo: session aggregate, non-empty snapshot, completion gate. 15. Context, Turn and Delegation Budget: hard maximums, explicit blocked/escalation/error. 16. Feature 002/006 alignment: hierarchy telemetry for Event Bus/Process Table,
direct-child Session UI, OutputSpool refs, Feature 006 retrieval budget consumption. 17. Routing command surface: `smart.*`, `routing.*`, `budget.*`, `pools.*` via Feature 007. 18. `routing explain` reads persisted score/gate/candidate data (no model call). 19. `routing test` deterministic local simulation (zero model calls, zero mutations). 20. Smart UI indicator in TUI (`packages/tui/src/component/prompt/index.tsx:1441-1471`). 21. Routing persistence + replay: atomic commit, catalog version mismatch, recovery. 22. Full test matrix + OTEL labels + cardinality audit. 23. Docs/commit notes (no commit in this documentary pass).

---

## Feature cross-dependencies

| Feature                    | Dependency                                                                                | Interaction |
| -------------------------- | ----------------------------------------------------------------------------------------- | ----------- |
| 002 Task Lifecycle         | Hierarchy telemetry, Event Bus/Process Table for role/depth/fanout/validation             | S4, S15     |
| 003 Scheduled Jobs         | Job-owned Todo aggregate                                                                  | S10         |
| 004 Lang Lock              | Constraint in dispatch envelopes; objective/item follows Lang Lock                        | S9, S10     |
| 005 OutputSpool            | Workers write to spool; Managers read offset/limit; Architect receives refs               | S9, S10     |
| 006 Milvus Semantic        | `retrieval_top_k`/`rerank_top_k`/`max_skill_chunks` consumed from Budget policy           | S11, S15    |
| 007 Operator Control Plane | **Sole management authority** for all `smart.*`/`routing.*`/`telemetry.*` commands        | All slices  |
| 008 MCP Tools              | MCP sampling cannot bypass Smart/budget/LangLock/privacy; OTEL content-free spans/metrics | S3          |

**No changes to Features 002–008 artifacts in this plan.** Feature 001 adds
observable state (hierarchy role, validation state, budget consumption) that
Feature 002 Process Table and Event Bus can project. Feature 006 consumes Budget
policy fields; it does not own hard gates or final route selection.

---

## Validation checklist (plan complete when)

- [x] ADR-0001 (telemetry) and ADR-0002 (routing) cited as proposed; plan/tasks
      documentary only, not implementation
- [x] ADR-0003 (operator control plane) accepted; Feature 007 as sole management
      authority for all `smart.*`/`routing.*`/`telemetry.*` IDs
- [x] Phase 1 slices and Phase 2 deferral explicit
- [x] Reuse Catalog.Service/ModelsDev, SessionRunnerModel, AgentV2, SkillV2,
      PermissionV2/Policy, EventV2, Session/Task lifecycle stated
- [x] No parallel runtime, catalog, resolver, registry, schema/event identity,
      execution loop, `smart_task`, or retry controller
- [x] Phase 1 additive and non-breaking (telemetry disabled until configured)
- [x] Phase 2 routing introduces core seam without changing existing Task lifecycle
- [x] Hard gates authoritative over model recommendations
- [x] No hardcoded model/provider IDs; user-configured role pools only
- [x] Bounded cardinality (ADR-0001/001 spec rules)
- [x] Privacy redaction defaults (prompts, secrets, personal paths, file content,
      tool payloads excluded)
- [x] Context, Turn and Delegation Budget with hard maximums not relaxable by models
- [x] Mandatory session-owned Todo with durable snapshot, completion gate, no shared lists
- [x] specScopeGlobs applied and verified in `doc/arch/speckit.toml` (Feature 007 paths preserved)
- [x] All companion artifacts listed (`data-model.md`, `contracts/`, `hierarchy-flow.md`)
- [x] Feature cross-dependencies mapped (002–008, 007)
- [x] Rollback and recovery strategy documented per layer
- [x] Testing matrix: unit/integration/contract/e2e per slice
- [x] Open clarification parameters acknowledged but not blocking plan (thresholds,
      numeric defaults, exact validation criteria — refine in tasks phase)
