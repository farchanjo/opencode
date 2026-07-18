# Data Model: Smart Agent Routing and Telemetry Foundation (Feature 001)

Feature: [001 Smart Agent Routing and Telemetry Foundation](spec.md)
Status: draft (to be finalized in tasks phase)

---

## Telemetry Configuration (Phase 1)

Persisted via Config.Service under Feature 007 operator control plane.
Secret fields use `SecretRef` (OS keychain reference), never plaintext.

```typescript
// packages/schema/src/telemetry/config.ts (novo)

export const TelemetryConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  endpoint: Schema.String,
  transport: Schema.Union(Schema.literal("http/protobuf"), Schema.literal("grpc")),
  headers: Schema.Record(Schema.String, Schema.String), // SecretRef values only
  tls: Schema.Struct({
    enabled: Schema.Boolean,
    cert: Schema.String, // SecretRef
  }),
  signals: Schema.Struct({
    metrics: Schema.Boolean,
    logs: Schema.Boolean,
    traces: Schema.Boolean,
    profiling: Schema.Boolean,
  }),
  queue: Schema.Struct({
    capacity: Schema.Positive,
    batch_size: Schema.Positive,
    enqueue_timeout_ms: Schema.Positive,
    export_timeout_ms: Schema.Positive,
    retry_budget: Schema.NonNegative,
    drop_policy: Schema.Union(Schema.literal("drop"), Schema.literal("backpressure")),
  }),
  redact: Schema.Struct({
    prompts: Schema.Boolean,
    secrets: Schema.Boolean,
    file_paths: Schema.Boolean,
    tool_payloads: Schema.Boolean,
  }),
  resource_attributes: Schema.Record(Schema.String, Schema.String),
  sampling: Schema.Clamp(Schema.Number, { min: 0, max: 1 }),
})

export type TelemetryConfig = Schema.Schema.Type<typeof TelemetryConfigSchema>
export type SecretRef = string // resolved via Feature 007 SecretPort
```

**`SecretRef` canonical encoding.** A `SecretRef` is an opaque string that the
SecretPort adapter — and only that adapter — parses. Its canonical form is
`backend:name` or `backend:name@vN`: `backend` is a SecretPort backend id
(`keychain` or `env-ref`), `name` is the secret name, and the optional `@vN`
suffix pins an integer version `>= 1`. The empty string denotes "no reference
configured" (for example an unset TLS cert while TLS is disabled). Both the CUE
schema (`config.cue #SecretRef`) and the TypeScript schema constrain the string
to this pattern. The SecretPort keys on `{backend, name, version}`; the encoding
projects onto that key by splitting on the first `:` and the trailing `@vN`.
Legacy JSON (`{backend, name, version}`) is accepted for backward compatibility.

---

## Routing Configuration (Phase 2)

```typescript
// packages/schema/src/routing/config.ts (novo)

export type RolePoolID = string // e.g., "architect", "manager", "worker-fast-large"
export type TaskClass = "small" | "medium" | "large" | "complex"
export type RoutingProfile = "direct_worker" | "manager"
export type TaskEffort = "minimal" | "low" | "medium" | "high" | "massive"
export type ReasoningEffort = "minimal" | "low" | "medium" | "high"
export type ExecutionBoundary = "safe" | "retryable" | "mutation_risky"

export const RoutingConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  mode: Schema.Union(Schema.literal("always"), Schema.literal("auto"), Schema.literal("never")),
  strict_gates: Schema.Boolean,
  decision_model: Schema.Struct({
    pool: Schema.Array(RolePoolID),
  }),
  role_pools: Schema.Record(
    RolePoolID,
    Schema.Array(Schema.String), // ModelID values resolved at runtime from Catalog.Service
  ),
  fallback: Schema.Struct({
    floor_role: RolePoolID,
  }),
  capability: Schema.Struct({
    metadata_source: Schema.Union(Schema.literal("catalog"), Schema.literal("override"), Schema.literal("observed")),
    unknown_policy: Schema.Union(Schema.literal("deny"), Schema.literal("allow")),
    probing_enabled: Schema.Boolean,
  }),
  budget: BudgetPolicySchema,
  hierarchy: Schema.Struct({
    max_depth: Schema.Constant(2), // Architect → Manager → Worker
    orchestration_only: Schema.Boolean,
  }),
})

export type RoutingConfig = Schema.Schema.Type<typeof RoutingConfigSchema>
```

---

## Budget Policy (Phase 2)

Named transversal policy applied per global, project, routing profile, task class,
and role. Hard maximums MUST NOT be relaxed by a model, plugin, MCP, or nested
instruction.

```typescript
// packages/schema/src/routing/budget.ts (novo)

export const BudgetPolicySchema = Schema.Struct({
  max_turns: Schema.Positive,
  max_context_tokens: Schema.Positive,
  max_context_bytes: Schema.Positive,
  max_output_tokens: Schema.Positive,
  max_output_bytes: Schema.Positive,
  max_workers: Schema.Positive, // fanout cap
  max_delegation_depth: Schema.Constant(2),
  retrieval_top_k: Schema.NonNegative,
  rerank_top_k: Schema.NonNegative,
  max_skill_chunks: Schema.Positive,
  max_skill_tokens: Schema.Positive,
  time_budget_ms: Schema.Positive,
  cost_budget_usd: Schema.Number,
  token_budget: Schema.Positive,
  retry_depth: Schema.NonNegative,
  validation_depth: Schema.NonNegative,
  escalation_threshold: Schema.String, // structured signal name
})

export type BudgetPolicy = Schema.Schema.Type<typeof BudgetPolicySchema>

export const BudgetConsumptionSchema = Schema.Struct({
  turns_used: Schema.NonNegative,
  context_tokens_used: Schema.NonNegative,
  output_tokens_used: Schema.NonNegative,
  workers_requested: Schema.NonNegative,
  workers_granted: Schema.NonNegative,
  delegation_depth_used: Schema.NonNegative,
  retrieval_chunks_used: Schema.NonNegative,
  skill_tokens_used: Schema.NonNegative,
  time_ms_used: Schema.NonNegative,
  cost_usd_used: Schema.Number,
  retry_count: Schema.NonNegative,
  validation_count: Schema.NonNegative,
  escalation_count: Schema.NonNegative,
})

export type BudgetConsumption = Schema.Schema.Type<typeof BudgetConsumptionSchema>

export const BudgetPolicySnapshotSchema = Schema.Struct({
  policy: BudgetPolicySchema,
  applied_at: Schema.String, // ISO 8601
  scope: Schema.Union(Schema.literal("global"), Schema.literal("project"), Schema.literal("session")),
  routing_profile: Schema.String,
  task_class: Schema.String,
  role: Schema.String,
})

export type BudgetPolicySnapshot = Schema.Schema.Type<typeof BudgetPolicySnapshotSchema>
```

---

## Routing Decision Record (Phase 2)

Immutable record persisted locally. Schema version field enables replay compatibility.

```typescript
// packages/schema/src/routing/decision.ts (novo)

export const GateResultSchema = Schema.Struct({
  dimension: Schema.String, // e.g., "tool_call_present", "parallel_calls", "continuation"
  passed: Schema.Boolean,
  reason: Schema.String,
  requirement: Schema.String, // what the task required
  candidate_value: Schema.Unknown, // what the candidate provided
  scope: Schema.String, // provider/model/variant/API
})

export const CandidateRecordSchema = Schema.Struct({
  agent_id: Schema.String,
  model_id: Schema.String,
  skills: Schema.Array(Schema.String),
  effort: Schema.String,
  reasoning_effort: Schema.String,
  gate_results: Schema.Array(GateResultSchema),
  final_score: Schema.Number,
  rank: Schema.Positive,
  rejected: Schema.Boolean,
  rejection_reasons: Schema.Array(Schema.String),
})

export const RankedCandidateSchema = Schema.Struct({
  agent_id: Schema.String,
  model_id: Schema.String,
  rank: Schema.Positive,
  score_breakdown: Schema.Record(Schema.String, Schema.Number),
  tie_break_applied: Schema.Boolean,
})

export const AuthContextSnapshotSchema = Schema.Struct({
  permission_mode: Schema.String,
  policy_version: Schema.String,
  hard_gates_authoritative: Schema.Boolean,
})

export const RoutingDecisionSchema = Schema.Struct({
  id: Schema.String, // ULID
  version: Schema.Positive,
  session_id: Schema.String,
  turn_id: Schema.String,
  task_fingerprint: Schema.String, // deterministic hash for cache/replay

  // Task classification
  task_class: Schema.String,
  routing_profile: Schema.String,
  task_effort: Schema.String,
  reasoning_effort: Schema.String,

  // Two-stage pipeline
  specialist_agent: Schema.String, // AgentID
  executor_model: Schema.String, // ModelID
  selected_skills: Schema.Array(Schema.String),
  provider_variant: Schema.String,

  // Hard gates
  gates: Schema.Array(GateResultSchema),

  // Decision model
  decision_model_id: Schema.NullOr(Schema.String),
  decision_inputs: Schema.NullOr(Schema.Unknown),
  decision_output: Schema.NullOr(Schema.Unknown),

  // Ranking
  candidates: Schema.Array(CandidateRecordSchema),
  ranking: Schema.Array(RankedCandidateSchema),
  tie_break: Schema.NullOr(Schema.String),

  // Budget
  budget: BudgetPolicySnapshotSchema,
  budget_consumed: BudgetConsumptionSchema,

  // Versions
  catalog_version: Schema.String,
  policy_version: Schema.String,

  // Auth
  auth_context: AuthContextSnapshotSchema,

  // Execution boundary
  execution_boundary: Schema.String, // "safe" | "retryable" | "mutation_risky"

  // Fallback
  fallback_attempted: Schema.Boolean,
  fallback_reason: Schema.NullOr(Schema.String),
  fallback_candidates: Schema.NullOr(Schema.Array(Schema.String)),

  // Metadata
  created_at: Schema.String, // ISO 8601
  decision_latency_ms: Schema.Number,
  offline: Schema.Boolean,
})

export type RoutingDecision = Schema.Schema.Type<typeof RoutingDecisionSchema>
```

---

## Tool Capability Record (Phase 2)

```typescript
// packages/schema/src/routing/capability.ts (novo)

export const ToolCapabilityDimensionsSchema = Schema.Struct({
  tool_call_present: Schema.NullOr(Schema.Boolean),
  max_calls_per_turn: Schema.NullOr(Schema.Positive),
  same_turn_multiple_calls: Schema.NullOr(Schema.Boolean),
  serial_runner_execution: Schema.NullOr(Schema.Boolean),
  parallel_calls: Schema.NullOr(Schema.Boolean),
  continuation_after_tool_result: Schema.NullOr(Schema.Boolean),
  multi_turn_cycles: Schema.NullOr(Schema.Boolean),
})

export const CapabilitySourceSchema = Schema.Union(
  Schema.literal("catalog"),
  Schema.literal("override"),
  Schema.literal("observed"),
)

export const CapabilityRecordSchema = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  variant: Schema.String,
  api: Schema.String,

  dimensions: ToolCapabilityDimensionsSchema,

  source: CapabilitySourceSchema,
  confidence: Schema.Clamp(Schema.Number, { min: 0, max: 1 }),
  timestamp: Schema.String, // ISO 8601
  ttl_ms: Schema.Positive,
  scope: Schema.String, // provider/model/variant/API
})

export type CapabilityRecord = Schema.Schema.Type<typeof CapabilityRecordSchema>

export const CapabilityMismatchSchema = Schema.Struct({
  dimension: Schema.String,
  requirement: Schema.String,
  candidate_value: Schema.Unknown,
  reason: Schema.String,
  scope: Schema.String,
  outcome: Schema.Union(
    Schema.literal("hard_gate_reject"),
    Schema.literal("serialization"),
    Schema.literal("fallback"),
  ),
})

export type CapabilityMismatch = Schema.Schema.Type<typeof CapabilityMismatchSchema>
```

---

## Hierarchy Events (Phase 2)

Published to EventV2 for Feature 002 Process Table and Event Bus projection.

```typescript
// packages/schema/src/routing/events.ts (novo)

export const HierarchyRoleSchema = Schema.Union(
  Schema.literal("architect"),
  Schema.literal("manager"),
  Schema.literal("worker"),
)

export const RoutingEventSchema = Schema.TaggedUnion("type", [
  Schema.Struct({
    type: Schema.Literal("routing.decision"),
    session_id: Schema.String,
    turn_id: Schema.String,
    decision_id: Schema.String,
    task_class: Schema.String,
    routing_profile: Schema.String,
    specialist_agent: Schema.String,
    executor_model: Schema.String,
    hierarchy_role: HierarchyRoleSchema,
    budget_policy_snapshot: BudgetPolicySnapshotSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("routing.fallback"),
    decision_id: Schema.String,
    reason: Schema.String,
    execution_boundary: Schema.String,
    candidate_selected: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("hierarchy.dispatch"),
    parent_session_id: Schema.String,
    child_session_id: Schema.String,
    parent_role: HierarchyRoleSchema,
    child_role: HierarchyRoleSchema,
    delegation_depth: Schema.NonNegative,
    fanout_requested: Schema.NonNegative,
    fanout_granted: Schema.NonNegative,
    todo_ref: Schema.String,
    todo_version: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("hierarchy.validation"),
    session_id: Schema.String,
    role: HierarchyRoleSchema,
    outcome: Schema.Union(
      Schema.literal("passed"),
      Schema.literal("failed"),
      Schema.literal("low_confidence"),
      Schema.literal("escalated"),
    ),
    validation_reason: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("hierarchy.escalation"),
    worker_session_id: Schema.String,
    reason: Schema.String,
    evidence_refs: Schema.Array(Schema.String),
    reclassified_to: Schema.Literal("manager"),
  }),
  Schema.Struct({
    type: Schema.Literal("capability.mismatch"),
    provider: Schema.String,
    model: Schema.String,
    dimension: Schema.String,
    requirement: Schema.String,
    outcome: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("todo.initialized"),
    session_id: Schema.String,
    todo_ref: Schema.String,
    todo_version: Schema.String,
    item_count: Schema.NonNegative,
  }),
  Schema.Struct({
    type: Schema.Literal("todo.completion_blocked"),
    session_id: Schema.String,
    reason: Schema.String,
    pending_items: Schema.NonNegative,
  }),
])

export type RoutingEvent = Schema.Schema.Type<typeof RoutingEventSchema>
```

---

## TUI Smart State (Phase 2)

```typescript
// packages/schema/src/tui/smart-state.ts (novo)

export const SmartIndicatorStateSchema = Schema.Union(
  Schema.Struct({
    active: Schema.True,
    reason: Schema.String, // "brain_mode + smart_routing_active"
    routing_profile: Schema.String,
    hierarchy_role: Schema.String,
  }),
  Schema.Struct({
    active: Schema.False,
    reason: Schema.String, // "brain_inactive" | "routing_inactive" | "degraded"
    degraded_reason: Schema.NullOr(Schema.String),
    fallback_text: Schema.String,
  }),
)

export type SmartIndicatorState = Schema.Schema.Type<typeof SmartIndicatorStateSchema>
```

---

## Resolved Parameters (implement phase)

The implement phase fixes each parameter as follows. These decisions are
authoritative for the routing and telemetry domain code.

- **Classifier thresholds and weights**: the domain module exports the tuning
  surface as data under `DEFAULT_CLASSIFIER_THRESHOLDS` (domain count,
  independent work units, mutation/risk, ambiguity, context size, expected
  tools, parallelism, security/migration/external effects). Configuration
  overrides the exported defaults without touching the algorithm.
- **Capability layer precedence**: an `override` layer wins over an `observed`
  layer, which wins over the `catalog` baseline. Resolution walks the layers in
  `override > observed > catalog` order and takes the first present value per
  dimension.
- **Decision-model bypass policy**: the pipeline skips the decision model when
  fewer than two candidates survive the hard gates (nothing to decide) or when
  the caller forces bypass. A bypassed decision records structured null
  decision-model fields, never a fabricated model call.
- **`BudgetPolicy` numeric defaults**: each scope/profile/role resolves to a
  concrete `BudgetPolicy` snapshot at decision time. The schema constraints in
  `budget.cue` bound every field; profile and role tables supply the numeric
  values captured in the persisted `BudgetPolicySnapshot`.
- **`RolePoolID` names and pool surface**: role pools key on the canonical role
  ids (`architect`, `manager`, `worker`) plus worker size/speed suffixes, each
  mapping to an ordered `ModelID` list resolved from `Catalog.Service`.
- **Validation acceptance criteria**: Worker, Manager and Architect validation
  steps gate on the recorded confidence against the role confidence floor;
  a below-floor outcome reclassifies to the Manager path rather than passing.
- **`TodoRef`/`TodoVersion` structure**: a Todo aggregate carries a stable item
  id, objective, typed status/priority, owner Session/role, result/evidence
  `OutputRefs`, aggregate outcome and timestamps. `TodoVersion` is an opaque
  monotonic version token.
- **Todo status vocabulary**: the closed set is `pending | in_progress |
  completed | cancelled`. Concurrent updates use compare-and-set on the
  `TodoVersion` token: an update applies only when its expected version equals
  the current version, and a mismatch fails the update for the caller to retry.
- **Todo lifecycle**: `cancelled` is the terminal state for abandoned or stale
  work; the completion gate blocks aggregate completion while any item is
  `pending` or `in_progress`. Completion-gate overrides require an operator
  principal, an audit record and explicit recovery.
- **Todo quantitative limits**: item counts, objective lengths and summary
  bounds derive from the active `BudgetPolicy` retrieval and output limits.
- **Telemetry backpressure**: the bounded export queue applies drop-oldest
  eviction under the `backpressure` policy — it evicts the oldest buffered
  signal to admit the newest and never blocks the hot path; the `drop` policy
  rejects the incoming signal instead.
- **`TaskAnalyzer` deterministic port**: the model-free derivation of
  `DecisionInputs`, hard-gate `DimensionRequirements` and `RankingCriteria` from
  a task description is a pure, deterministic heuristic (composition-root
  `task-analyzer.ts`) — zero model calls, no clock, no randomness. Documented
  lexicons drive each signal: domain families → `domain_count`; enumeration
  markers (commas, `and`, newlines, bullets, `then`) → `independent_units`;
  description byte length → `context_size`; verb→tool keyword maps →
  `expected_tools`/`requiredSkills`; mutation/ambiguity/security/external term
  sets → the four `risk` unit intervals; parallel terms plus independent units →
  `parallelism`. The raw string never reaches a model, keeping the "zero LLM
  call" invariant honest. A hard-gate requirement is only asserted when
  positively justified from the text (tool-call presence when tools are
  expected); everything else stays unknown and the config `unknown_policy`
  governs it. The lexicons are exported defaults (open-parameter surface) a
  future routing policy can override wholesale.
- **`routing.explain` not-found mapping**: an explain request for an unknown
  `decisionId` maps to `RoutingError.invalid_argument` with `field: "decisionId"`
  (not `unavailable`), so the operator envelope reports a bad argument rather
  than a backend outage. A genuine store read failure still maps to
  `unavailable`.
- **Reserved-catalog additions (v1.1.0)**: `RESERVED_CATALOG_VERSION` bumps to
  `1.1.0` (additive) to add the read-only routing surface the `RoutingPort` and
  CLI require: `routing.explain` and `routing.capability.inspect`. Both are
  non-mutating, offline-capable, `global`/`project` scoped, and require no
  confirmation. Feature 007 remains the sole command-registration authority; the
  routing inbound adapter only supplies the `DomainInvoke` for these ids.
- **Composition-root routing wiring**: the live operator stack registers the
  routing domain port with real seams — `Config.Service`-backed config source,
  a `Provider.Service` catalog candidate source (live model catalog, never
  hardcoded ids), the `AgentV2` specialist registry (`listSpecialists`, hidden
  agents excluded) as the `AgentResolver`, a filesystem `DecisionStore` rooted
  under the state dir (`<state>/routing-decisions`), the deterministic
  `TaskAnalyzer`, and a non-blocking OTLP telemetry sink. Agent skill/effort
  metadata is not yet carried on `Agent.Info`, so the specialist pool exposes
  empty skills and neutral effort defaults today; hard gates and ranking still
  apply. Telemetry/Smart inbound domain ports have no `DomainInvoke` adapter yet,
  so only routing overrides the stub.
- **TUI Smart indicator signal source**: the Smart indicator is a per-turn,
  server-side routing computation. The TUI sync payload carries session status,
  config, agents and messages but no brain-mode / Smart-Routing / hierarchy-role
  signal, and no `smart.*`/`routing.*` server event exists to derive one from.
  A genuine live signal therefore waits for a server-push feature — a
  routing-state projection pushed the same way `session_status` is. Until then
  the prompt component binds a single reactive accessor to the honest inactive
  baseline (fallback label only); when the push lands, only that accessor's body
  changes.
