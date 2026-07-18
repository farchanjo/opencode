# Data Model: Event-Driven Asynchronous Task Lifecycle Engine (Feature 002)

Feature: [002 Task Lifecycle Engine](spec.md)
Plan: [plan.md](plan.md)
Research: [research.md](research.md)
Status: draft (finalized in the tasks phase; numeric defaults resolved in the future
ADR **Task Process Lifecycle and Operational Observation**)

Every entity below is an in-memory or on-the-wire projection over the single EventV2
authority (C2). No shape here is a store of record: the Process Table is rebuilt by
replaying the durable aggregate (C6), and each lifecycle event registers through
`EventV2.define` on the existing `EventV2Bridge` (C1, C3).

## Schema surface conventions

All TypeScript shapes use this repository's Effect `Schema` v4 surface, matching
`packages/schema/src/schema.ts` and the existing schema modules:

- Closed enums use `Schema.Literals([...])`; a single discriminant literal uses
  `Schema.Literal("...")`.
- Bounded integers reuse the shared `PositiveInt` / `NonNegativeInt` from
  `packages/schema/src/schema.ts` (`Schema.Int.check(Schema.isGreaterThan(0))` and
  `Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))`); real-valued fields use
  `Schema.Finite`, and unit intervals use `Schema.Finite.check(Schema.isBetween(0, 1))`.
- Identifiers are branded strings (`Schema.String.pipe(Schema.brand("Lifecycle.XId"))`).
- Optional keys use the shared `optional(...)` helper; explicit nullable fields use
  `Schema.NullOr(...)`.
- Epoch-millis timestamps decode through `DateTimeUtcFromMillis`.
- No stale `Schema.literal` / `Schema.Clamp` / `Schema.Positive` / `Schema.Number`
  forms are used; those are not part of this repository's surface.

Each shape names its target module under `packages/schema/src/lifecycle/**` and mirrors a
CUE definition under `doc/arch/schemas/lifecycle/*.cue` one-to-one.

---

## Shared identifiers

```typescript
// packages/schema/src/lifecycle/ids.ts (novo)

import { Schema } from "effect"

// task_id identifies the logical Task; process_id identifies one attempt/execution.
// process_id is NEVER an OS PID and implies no kill semantics (FR7, C8).
export const TaskId = Schema.String.pipe(Schema.brand("Lifecycle.TaskId"))
export const ProcessId = Schema.String.pipe(Schema.brand("Lifecycle.ProcessId"))
export const ParentProcessId = Schema.String.pipe(Schema.brand("Lifecycle.ParentProcessId"))
export const RootProcessId = Schema.String.pipe(Schema.brand("Lifecycle.RootProcessId"))

// Name parity with routing.shared.#SessionId — re-declared here; no cross-feature import.
export const SessionId = Schema.String.pipe(Schema.brand("Lifecycle.SessionId"))
export const ParentSessionId = Schema.String.pipe(Schema.brand("Lifecycle.ParentSessionId"))
export const RootSessionId = Schema.String.pipe(Schema.brand("Lifecycle.RootSessionId"))

export const RuntimeInstanceId = Schema.String.pipe(Schema.brand("Lifecycle.RuntimeInstanceId"))
export const LeaseId = Schema.String.pipe(Schema.brand("Lifecycle.LeaseId"))

// EventV2 assigns the evt_ id; carried on every envelope (C8).
export const EventId = Schema.String.pipe(Schema.brand("Lifecycle.EventId"))
```

```typescript
// packages/schema/src/lifecycle/correlation-ids.ts (novo)

// Correlation identity plus the fields reused verbatim from Feature 001 (C15).
export const CorrelationId = Schema.String.pipe(Schema.brand("Lifecycle.CorrelationId"))
export const CausationId = Schema.String.pipe(Schema.brand("Lifecycle.CausationId"))

// Name parity with routing.shared: DecisionId / TurnId / ModelId / ProviderName / VariantName.
export const DecisionId = Schema.String.pipe(Schema.brand("Lifecycle.DecisionId"))
export const TurnId = Schema.String.pipe(Schema.brand("Lifecycle.TurnId"))
export const AgentName = Schema.String.pipe(Schema.brand("Lifecycle.AgentName"))
export const ModelId = Schema.String.pipe(Schema.brand("Lifecycle.ModelId"))
export const ProviderName = Schema.String.pipe(Schema.brand("Lifecycle.ProviderName"))
export const VariantName = Schema.String.pipe(Schema.brand("Lifecycle.VariantName"))

// Todo aggregate reference and opaque monotonic version token (C23).
export const TodoRef = Schema.String.pipe(Schema.brand("Lifecycle.TodoRef"))
export const TodoVersion = Schema.String.pipe(Schema.brand("Lifecycle.TodoVersion"))
```

Quantitative and telemetry value objects keep primitive obsession out of the aggregates:

```typescript
// packages/schema/src/lifecycle/values.ts (novo)

export const Sequence = NonNegativeInt          // per-aggregate order; no global order (C8)
export const Attempt = PositiveInt              // 1-based attempt of a task_id (C8)
export const Generation = NonNegativeInt        // fencing generation (C8, C16)
export const SchemaVersion = PositiveInt        // EventV2 durable.version counter (C4)
export const DelegationDepth = NonNegativeInt   // 0 = root; Architect->Manager->Worker (C15)
export const FanoutCount = NonNegativeInt       // requested vs granted worker fanout (C11)
export const ItemCount = NonNegativeInt         // bounded Todo item counts (C23)
export const Reason = Schema.String             // bounded redacted explanation (FR13)
export const Description = Schema.String        // bounded redacted description (FR28)
export const ActivityLabel = Schema.String      // rendered from an allowlisted ActivityKind (FR56)

// packages/schema/src/lifecycle/usage-values.ts (novo)

export const TokenCount = NonNegativeInt         // never sum unknown fields (C21)
export const CostUsd = Schema.Finite             // provider/estimate cost (C21)
export const ElapsedMs = NonNegativeInt          // monotonic elapsed for tokens/s (C21)
export const DurationMs = NonNegativeInt         // TTFT / stream / total durations (FR26)
export const TokensPerSecond = Schema.Finite     // valid only from monotonic elapsed (C21)
export const TraceId = Schema.String.pipe(Schema.brand("Lifecycle.TraceId"))
export const SpanId = Schema.String.pipe(Schema.brand("Lifecycle.SpanId"))
export const OutputRef = Schema.String.pipe(Schema.brand("Lifecycle.OutputRef")) // Feature 005 owns content (C20)
export const Cursor = Schema.String.pipe(Schema.brand("Lifecycle.Cursor"))
export const Confidence = Schema.Finite.check(Schema.isBetween(0, 1)) // evidence confidence (C18)
```

---

## Enumerations

```typescript
// packages/schema/src/lifecycle/enums.ts (novo)

// The ten Process Table states (C7, FR25). handoff is an event, never a state.
export const ProcessState = Schema.Literals([
  "created", "queued", "waiting", "running", "cancelling",
  "completed", "failed", "cancelled", "zombie", "unknown",
])

// The 26-member lifecycle event vocabulary (FR20). Prefixed lifecycle.* on the bus.
export const LifecycleEventType = Schema.Literals([
  "lifecycle.admitted", "lifecycle.parent_attached", "lifecycle.process_created",
  "lifecycle.queued", "lifecycle.waiting", "lifecycle.started", "lifecycle.promoted",
  "lifecycle.extended", "lifecycle.handoff", "lifecycle.steer_requested",
  "lifecycle.steer_accepted", "lifecycle.steer_rejected", "lifecycle.turn_started",
  "lifecycle.turn_ended", "lifecycle.turn_failed", "lifecycle.tool_called",
  "lifecycle.tool_settled", "lifecycle.cancel_requested", "lifecycle.cancelling",
  "lifecycle.completed", "lifecycle.failed", "lifecycle.cancelled",
  "lifecycle.owner_lost", "lifecycle.zombie_detected", "lifecycle.reconciled",
  "lifecycle.unknown",
])

// Durable events replay through readAggregate; live events omit durable (C4).
export const EventClass = Schema.Literals(["durable", "live"])

// Terminal reason recorded on completed/failed/cancelled events and rows (FR23, FR27).
export const TerminalReason = Schema.Literals([
  "completed_ok", "error", "cancelled_by_operator", "cancelled_by_root",
  "zombie", "owner_lost", "reconciled_unknown",
])

// Settlement sub-state on a terminal row; Feature 005 owns settlement (C20).
export const SettlementState = Schema.Literals(["settled", "settling", "unknown", "corrupt"])

// Visibility scope enforced before delivery (FR11, C14).
export const Visibility = Schema.Literals(["session", "tree", "global_privileged"])

// Who the event and process belong to.
export const AgentKind = Schema.Literals(["architect", "manager", "worker", "subagent", "primary"])
export const ActorKind = Schema.Literals(["runtime", "operator", "executor"])
```

```typescript
// packages/schema/src/lifecycle/enums-observation.ts (novo)

// Live-usage provenance and source (C21).
export const UsageProvenance = Schema.Literals(["estimated", "reported"])
export const UsageSource = Schema.Literals(["provider", "runtime", "local_estimate"])

// Allowlisted card activity kinds; no raw prompts/paths reach the renderer (FR56).
export const ActivityKind = Schema.Literals([
  "read", "edit", "run_command", "search", "waiting", "generating", "settling",
])

// Hierarchy role and validation outcome reused from Feature 001 (C15).
export const HierarchyRole = Schema.Literals(["architect", "manager", "worker"])
export const ValidationOutcome = Schema.Literals(["passed", "failed", "low_confidence", "escalated"])

// Projection anomalies surfaced without inventing terminal state (C9, FR29).
export const AnomalyKind = Schema.Literals(["duplicate", "out_of_order", "unknown_event", "unreconciled"])

// Cancel outcomes; no remote kill or rollback is promised (C17, FR41).
export const CancelOutcome = Schema.Literals(["requested", "accepted", "rejected", "unknown", "unconfirmed"])

// Watchdog / reconciliation outcomes without claiming a provider stopped (C12).
export const WatchdogOutcome = Schema.Literals(["owner_lost", "zombie_detected", "unknown", "reconciled"])

// Per-scope admission budgets (C11) and the observation surface (C14).
export const AdmissionScope = Schema.Literals([
  "global", "root", "session", "child", "provider", "agent", "tool",
  "event_queue", "otel_queue", "sqlite", "token", "cost",
])
export const AdmissionDecision = Schema.Literals(["granted", "partial", "queued", "rejected"])
export const ObservationKind = Schema.Literals(["session", "process", "tree", "global"])
```

---

## LifecycleEnvelope (FR9)

Common carrier on every lifecycle event. Kept small by composing sub-objects, each at
most seven fields, so no aggregate exceeds the calisthenics bound. `hierarchy` is present
only when Smart hierarchical routing is active (C15); its fields are reused verbatim from
the Feature 001 `routing.decision` / `hierarchy.*` schemas rather than recomputed.

```typescript
// packages/schema/src/lifecycle/envelope.ts (novo)

export const EventKind = Schema.Struct({
  event_type: LifecycleEventType,
  schema_version: SchemaVersion,
  event_class: EventClass,
  agent_kind: AgentKind,
  actor_kind: ActorKind,
  runtime_instance_id: RuntimeInstanceId,
})

export const TreeIdentity = Schema.Struct({
  root_session_id: RootSessionId,
  session_id: SessionId,
  parent_session_id: Schema.NullOr(ParentSessionId),
})

export const ProcessIdentity = Schema.Struct({
  task_id: TaskId,
  process_id: ProcessId,
  parent_process_id: Schema.NullOr(ParentProcessId),
  root_process_id: RootProcessId,
})

export const Ordering = Schema.Struct({
  sequence: Sequence,          // per aggregate only; no global order (C8)
  correlation_id: CorrelationId,
  causation_id: Schema.NullOr(CausationId),
  attempt: Attempt,
  generation: Generation,
})

export const Delivery = Schema.Struct({
  visibility: Visibility,
  timestamp: DateTimeUtcFromMillis,
  // Redacted: no prompts, results, tool payloads, paths, or secrets (FR13, FR28).
  redacted_metadata: Schema.Record(Schema.String, Schema.String),
})

export const HierarchyContext = Schema.Struct({
  role: HierarchyRole,
  delegation_depth: DelegationDepth,
  delegation_path: Schema.Array(SessionId),
  fanout: Schema.Struct({ requested: FanoutCount, granted: FanoutCount }),
  validation_outcome: Schema.NullOr(ValidationOutcome),
  correlation: Schema.Struct({ decision_id: DecisionId, turn_id: TurnId }),
})

// The envelope is a value bundle; the identifiable message is the lifecycle event
// member that carries it. event_id is held as a value, assigned by EventV2 (C8).
export const LifecycleEnvelope = Schema.Struct({
  event_id: EventId,
  kind: EventKind,
  tree: TreeIdentity,
  process: ProcessIdentity,
  ordering: Ordering,
  delivery: Delivery,
  hierarchy: Schema.NullOr(HierarchyContext),
})
export type LifecycleEnvelope = Schema.Schema.Type<typeof LifecycleEnvelope>
```

---

## LiveUsage and provenance (C21)

Missing live usage is an explicit unavailable state — never zero, never fabricated.
Provider-reported usage reconciles and replaces an estimate at settlement; unknown token
fields are never summed; `tokens_per_second` is valid only from monotonic elapsed time.

```typescript
// packages/schema/src/lifecycle/usage.ts (novo)

// Each present token field is a known count; an absent key is "unavailable" (C21).
export const TokenBreakdown = Schema.Struct({
  input: optional(TokenCount),
  output: optional(TokenCount),
  reasoning: optional(TokenCount),
  cache_read: optional(TokenCount),
  cache_write: optional(TokenCount),
})

export const UsageProvenanceMark = Schema.Struct({
  provenance: UsageProvenance,  // estimated | reported
  source: UsageSource,          // provider | runtime | local_estimate
})

export const LiveUsage = Schema.Struct({
  available: Schema.Boolean,    // false renders "tokens unavailable" (AC25)
  tokens: TokenBreakdown,
  cost_usd: optional(CostUsd),
  provenance: UsageProvenanceMark,
  elapsed_ms: ElapsedMs,        // monotonic; the only tokens/s denominator (C21)
  tokens_per_second: Schema.NullOr(TokensPerSecond), // null unless valid
})
export type LiveUsage = Schema.Schema.Type<typeof LiveUsage>
```

---

## Lifecycle event vocabulary (FR20, FR21)

The 26 members form a closed tagged union. Every member carries the `envelope`; a member
with a distinct payload adds one `detail` sub-object so `extend`, `promote`, `steer`, and
`handoff` stay distinct semantic events and are never collapsed into a generic status
update (FR21). Mirroring the Feature 001 routing pattern, each member is registered as its
own `EventV2.define` `Definition` on the `EventV2Bridge` (`dataFields(Member.fields)`), so
no raw tagged union is wired to the bus (C2). Durable members carry the EventV2
`durable {version, aggregate: "root_process_id"}` annotation; live members omit it (C4).

Detail sub-objects:

```typescript
// packages/schema/src/lifecycle/events.ts (novo)

export const AdmissionDetail = Schema.Struct({
  scope: AdmissionScope,
  decision: AdmissionDecision,
  fanout: Schema.Struct({ requested: FanoutCount, granted: FanoutCount }),
})

export const HandoffDetail = Schema.Struct({
  source: Schema.Struct({ session_id: SessionId, process_id: ProcessId }),
  target: Schema.Struct({ session_id: SessionId, process_id: ProcessId }),
  reason: Reason,
  generation: Generation,
})

export const TerminalDetail = Schema.Struct({
  reason: TerminalReason,
  settlement: SettlementState,
  final_usage: LiveUsage,
})

export const WatchdogDetail = Schema.Struct({
  outcome: WatchdogOutcome,
  lease_id: Schema.NullOr(LeaseId),
  reason: Reason,
})

export const ToolActivityDetail = Schema.Struct({
  activity: ActivityKind,     // allowlisted; renders to ActivityLabel (FR56)
  label: ActivityLabel,
})

export const SteerDetail = Schema.Struct({
  outcome: CancelOutcome,     // requested/accepted/rejected reuse the control-outcome set
  reason: Reason,
})

export const ReconcileDetail = Schema.Struct({
  outcome: WatchdogOutcome,
  from_version: SchemaVersion,
})
```

Member shape (durable example carries the annotation; envelope-only members omit `detail`):

```typescript
// packages/schema/src/lifecycle/events-durable.ts (novo)

// Durable (C4): admitted, parent_attached, process_created, started, handoff,
// completed, failed, cancelled, zombie_detected, reconciled, owner_lost.
export const AdmittedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.admitted"),
  envelope: LifecycleEnvelope,
  detail: AdmissionDetail,
})

export const HandoffEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.handoff"),
  envelope: LifecycleEnvelope,
  detail: HandoffDetail,          // one event projectable to both sessions (C16, FR22)
})

export const CompletedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.completed"),
  envelope: LifecycleEnvelope,
  detail: TerminalDetail,
})
// FailedEvent, CancelledEvent mirror CompletedEvent with TerminalDetail.

export const ZombieDetectedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.zombie_detected"),
  envelope: LifecycleEnvelope,
  detail: WatchdogDetail,
})
// OwnerLostEvent mirrors ZombieDetectedEvent; ReconciledEvent uses ReconcileDetail.

export const ProcessCreatedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.process_created"),
  envelope: LifecycleEnvelope,
})
// ParentAttachedEvent, StartedEvent are envelope-only durable checkpoints.
```

```typescript
// packages/schema/src/lifecycle/events-live.ts (novo)

// Live (C4): queued, waiting, promoted, extended, steer_requested, steer_accepted,
// steer_rejected, turn_started, turn_ended, turn_failed, tool_called, tool_settled,
// cancel_requested, cancelling, unknown.
export const ToolCalledEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.tool_called"),
  envelope: LifecycleEnvelope,
  detail: ToolActivityDetail,
})
// ToolSettledEvent mirrors ToolCalledEvent.

export const SteerRequestedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.steer_requested"),
  envelope: LifecycleEnvelope,
  detail: SteerDetail,
})
// steer_accepted / steer_rejected mirror this; cancel_requested / cancelling carry SteerDetail's CancelOutcome.

export const QueuedEvent = Schema.Struct({
  type: Schema.Literal("lifecycle.queued"),
  envelope: LifecycleEnvelope,
})
// waiting, promoted, extended, turn_started, turn_ended, turn_failed, unknown are envelope-only live members.

export const LifecycleEvent = Schema.TaggedUnion("type", [
  AdmittedEvent, HandoffEvent, CompletedEvent, ZombieDetectedEvent,
  ProcessCreatedEvent, ToolCalledEvent, SteerRequestedEvent, QueuedEvent,
  // ...the remaining members, one Struct per FR20 vocabulary entry.
])
export type LifecycleEvent = Schema.Schema.Type<typeof LifecycleEvent>
```

Durable definitions join the canonical inventory in
`packages/schema/src/durable-event-manifest.ts` through `Event.durable([...])` (C5), so
terminal events are preserved across bounded-queue overflow and restart by the durable
aggregate, never by the Process Table.

---

## ProcessRow (FR26)

The Process Table row is a read-only projection. It composes sub-objects to stay within
the calisthenics bounds and to keep high-cardinality identifiers out of any metric label
(C15, C18). Prompts, complete results, tool payloads, personal paths, and secrets are
outside the row by default (FR28).

```typescript
// packages/schema/src/lifecycle/process-row.ts (novo)

export const RowIdentity = Schema.Struct({
  task_id: TaskId,
  attempt: Attempt,
  generation: Generation,
  lease_id: Schema.NullOr(LeaseId),
})

export const RowStatus = Schema.Struct({
  state: ProcessState,
  reason: Schema.NullOr(TerminalReason),
  settlement: Schema.NullOr(SettlementState),  // terminal-not-settled until Feature 005 (C20)
  created_at: DateTimeUtcFromMillis,
  updated_at: DateTimeUtcFromMillis,
  terminal_at: Schema.NullOr(DateTimeUtcFromMillis),
})

export const RowHierarchy = Schema.Struct({
  role: HierarchyRole,
  delegation_depth: DelegationDepth,
  route_path: Schema.Array(SessionId),
  fanout: Schema.Struct({ requested: FanoutCount, granted: FanoutCount }),
  validation_outcome: Schema.NullOr(ValidationOutcome),
})

export const ProcessRow = Schema.Struct({
  id: ProcessId,               // row identity; never an OS PID (FR7, C8)
  identity: RowIdentity,
  lineage: RowLineage,         // relations + ownership + graph
  status: RowStatus,
  profile: RowProfile,         // classification + model
  accounting: RowAccounting,   // usage + outcome + telemetry
  hierarchy: Schema.NullOr(RowHierarchy),  // present when Smart routing is active (C15)
})
export type ProcessRow = Schema.Schema.Type<typeof ProcessRow>
```

```typescript
// packages/schema/src/lifecycle/process-row-parts.ts (novo)

export const RowRelations = Schema.Struct({
  parent_process_id: Schema.NullOr(ParentProcessId),
  root_process_id: RootProcessId,
  session_id: SessionId,
  parent_session_id: Schema.NullOr(ParentSessionId),
  root_session_id: RootSessionId,
})

export const RowOwnership = Schema.Struct({
  runtime_instance_id: RuntimeInstanceId,
  scope: Visibility,
  actor_kind: ActorKind,
})

export const RowGraph = Schema.Struct({
  dependencies: Schema.Array(ProcessId),
  children: Schema.Array(ProcessId),
  pending_inputs: Schema.Array(Reason),   // bounded labels, not payloads
  pending_steers: Schema.Array(Reason),
})

export const RowLineage = Schema.Struct({
  relations: RowRelations,
  ownership: RowOwnership,
  graph: RowGraph,
})

export const RowClassification = Schema.Struct({
  agent_name: AgentName,
  agent_kind: AgentKind,
  task_class: Schema.String,     // reuses the Feature 001 TaskClass vocabulary
  profile: Schema.String,        // direct_worker | manager (Feature 001 RoutingProfile)
  task_effort: Schema.String,
  reasoning_effort: Schema.String,
})

export const RowModel = Schema.Struct({
  provider: ProviderName,
  model: ModelId,
  variant: Schema.NullOr(VariantName),
})

export const RowProfile = Schema.Struct({
  classification: RowClassification,
  model: RowModel,
})

export const RowOutcome = Schema.Struct({
  cancel_outcome: Schema.NullOr(CancelOutcome),
  exit_reason: Schema.NullOr(Reason),
  error_reason: Schema.NullOr(Reason),
})

export const RowTelemetry = Schema.Struct({
  trace_id: Schema.NullOr(TraceId),  // IDs live in traces/logs only, never labels (C18)
  span_id: Schema.NullOr(SpanId),
  output_ref: Schema.NullOr(OutputRef),  // bounded ref; Feature 005 owns content (C20)
})

export const RowUsage = Schema.Struct({
  usage: LiveUsage,
  ttft_ms: Schema.NullOr(DurationMs),
  stream_ms: Schema.NullOr(DurationMs),
  total_ms: Schema.NullOr(DurationMs),
})

export const RowAccounting = Schema.Struct({
  usage: RowUsage,
  outcome: RowOutcome,
  telemetry: RowTelemetry,
})
```

---

## AdmissionBucket and capacity (C11)

Admission is a per-scope token bucket over measured capacity with hard ceilings and no
unbounded queue. Requested-versus-granted fanout is projected. The projection and any
observer are forbidden from calling admission (C11); these shapes are the admission
service's own state and its projected outcome.

```typescript
// packages/schema/src/lifecycle/admission.ts (novo)

export const CapacitySignals = Schema.Struct({
  cpu_saturation: Confidence,       // 0..1 measured saturation
  mem_saturation: Confidence,
  provider_saturation: Confidence,
  sqlite_saturation: Confidence,
  event_queue_saturation: Confidence,
  otel_queue_saturation: Confidence,
})

export const TokenBucketState = Schema.Struct({
  capacity: PositiveInt,            // hard ceiling; never relaxed by a model (FR34)
  available: NonNegativeInt,
  refill_per_second: PositiveInt,
})

export const AdmissionBucket = Schema.Struct({
  scope: AdmissionScope,
  bucket: TokenBucketState,
  fenced: Schema.Boolean,           // true after a root cancel quarantines the scope (C17)
})
export type AdmissionBucket = Schema.Schema.Type<typeof AdmissionBucket>

export const AdmissionResult = Schema.Struct({
  scope: AdmissionScope,
  decision: AdmissionDecision,      // granted | partial | queued | rejected
  fanout: Schema.Struct({ requested: FanoutCount, granted: FanoutCount }),
  reason: Reason,
})
export type AdmissionResult = Schema.Schema.Type<typeof AdmissionResult>
```

---

## WatchdogLease and reconciliation (C12, C13)

A single shared bucketed sweeper holds in-memory lease and heartbeat state — never one
timer per Task, never a per-heartbeat SQLite write. Reconciliation with durable Sessions
is explicit and versioned; no zombie or crash triggers automatic retry.

```typescript
// packages/schema/src/lifecycle/watchdog.ts (novo)

export const WatchdogLease = Schema.Struct({
  lease_id: LeaseId,
  process_id: ProcessId,
  runtime_instance_id: RuntimeInstanceId,   // owner of the lease
  last_heartbeat_at: DateTimeUtcFromMillis, // in-memory only (C12)
  expires_at: DateTimeUtcFromMillis,
})
export type WatchdogLease = Schema.Schema.Type<typeof WatchdogLease>

export const ZombieAssessment = Schema.Struct({
  process_id: ProcessId,
  outcome: WatchdogOutcome,   // owner_lost | zombie_detected | unknown (no provider-stop claim)
  reason: Reason,
})

export const ReconcileRecord = Schema.Struct({
  process_id: ProcessId,
  outcome: WatchdogOutcome,   // reconciled | unknown
  from_version: SchemaVersion,
  auto_retry: Schema.Literal(false),  // reconciliation never re-executes effects (C13, FR40)
})
export type ReconcileRecord = Schema.Schema.Type<typeof ReconcileRecord>
```

---

## CancelOutcome and root-tree cancel (C17)

Cancel is a request, not a mutation. A root cancel propagates through the canonical
`SessionRunCoordinator` root scope, fences descendant admission, and never promises remote
kill, reversal, or mutation rollback.

```typescript
// packages/schema/src/lifecycle/cancel.ts (novo)

export const RootCancelScope = Schema.Struct({
  root_session_id: RootSessionId,
  root_process_id: RootProcessId,
  press: Schema.Literals(["first", "second"]),  // second within the window forces local abort (C17)
})

export const CancelRequestRecord = Schema.Struct({
  scope: RootCancelScope,
  outcome: CancelOutcome,      // requested | accepted | rejected | unknown | unconfirmed
  fenced_descendants: Schema.Boolean,  // true once new descendants are quarantined (AC30)
  reason: Reason,
})
export type CancelRequestRecord = Schema.Schema.Type<typeof CancelRequestRecord>
```

---

## ObservationScope and payloads (C14)

Read-only Effect Stream/PubSub with scoped finalizers. Authorization and redaction run
before delivery; an Observable never controls lifecycle state and never mutates a row.

```typescript
// packages/schema/src/lifecycle/observation.ts (novo)

export const ObservationScope = Schema.Struct({
  kind: ObservationKind,        // session | process | tree | global
  session_id: Schema.NullOr(SessionId),
  process_id: Schema.NullOr(ProcessId),
  root_session_id: Schema.NullOr(RootSessionId),
  visibility: Visibility,       // global requires global_privileged (C14)
})
export type ObservationScope = Schema.Schema.Type<typeof ObservationScope>

export const ObservationFilter = Schema.Struct({
  scope: ObservationScope,
  event_types: Schema.Array(LifecycleEventType),  // empty = all authorized types
  include_terminal: Schema.Boolean,
})

export const AnomalyRecord = Schema.Struct({
  kind: AnomalyKind,            // duplicate | out_of_order | unknown_event | unreconciled
  process_id: ProcessId,
  reason: Reason,
})

export const ObservationResult = Schema.Struct({
  scope: ObservationScope,
  event: LifecycleEvent,        // already authorized and redacted (C14)
  anomaly: Schema.NullOr(AnomalyRecord),  // surfaced, never invents terminal state (C9)
})
export type ObservationResult = Schema.Schema.Type<typeof ObservationResult>
```

---

## Parameters

Every numeric contract is declared here as a provisional plan constant with a named
acceptance hook; the future ADR fixes final values (plan Non-goals, C10, C11, C12, C22).
No value is a hidden default: each is an explicit, overridable data constant on the domain
module, never inlined into an algorithm.

| Parameter | Provisional default | Scope | Acceptance hook |
| --------- | ------------------- | ----- | --------------- |
| `subscriber_queue_capacity` | 1024 events | per observer | AC7 |
| `subscriber_overflow_policy` | `backpressure` (drop-oldest live signal) | per observer | AC7, AC20 |
| `event_bus_queue_capacity` | 4096 events | per bus | AC20 |
| `otel_queue_capacity` | 2048 signals | export sink | AC17, reuses Feature 001 |
| `terminal_priority` | terminal/cancel/tool boundaries never dropped | global | AC8 |
| `live_coalesce_interval_ms` | 100 ms | progress/heartbeat | AC24 |
| `terminal_row_retention` | 200 terminal rows per root | per root | AC15, AC35 |
| `retention_prune_older_than_ms` | 3_600_000 ms (1 h) | durable aggregate | AC15 |
| `admission_ceiling.global` | 64 concurrent processes | global scope | AC1, AC21 |
| `admission_ceiling.root` | 16 concurrent processes | per root | AC1 |
| `admission_ceiling.session` | 8 concurrent processes | per session | AC1 |
| `admission_ceiling.child` | 6 fanout workers | per Manager dispatch | AC21 |
| `token_bucket_refill_per_second` | 8 tokens/s | per scope | AC1, AC21 |
| `fairness_weight.parent` | 2 | admission selection | AC21 |
| `fairness_weight.child` | 1 | admission selection | AC21 |
| `watchdog_sweep_interval_ms` | 1000 ms (single shared sweeper) | global | AC11 |
| `lease_ttl_ms` | 15_000 ms | per lease | AC11 |
| `heartbeat_interval_ms` | 5000 ms (in-memory only) | per owner | AC11 |
| `cancel_escalation_window_ms` | 3000 ms (first→second Ctrl+C) | per root | AC29 |
| `evidence_window_ms` | 300_000 ms (5 min) | local metrics store | AC16 |
| `evidence_confidence_floor` | 0.6 | Smart Routing read | AC16 |
| `evidence_ttl_ms` | 600_000 ms (10 min) | local metrics store | AC16 |
| `cardinality_budget` | 64 distinct dynamic ids → `other` | metric labels | AC17, reuses Feature 001 |
| `panel_max_cards` | 32 direct-child cards | per Session view | AC24, AC34 |
| `description_max_bytes` | 256 bytes | card description | AC28 |
| `activity_label_max_bytes` | 128 bytes | card activity | AC28 |
| `todo_item_max` | derived from Feature 001 `BudgetPolicy` retrieval/output limits | per Session | AC38 |

Related Feature 001 constants (telemetry queue, cardinality allowlist, budget policy) are
reused unchanged and are not re-declared here (C18).

---

## Resolved Parameters

The integration-wiring decisions taken when composing the lifecycle domain ports into
the live operator stack (`packages/opencode/src/operator/stack-live.ts` via
`packages/opencode/src/operator/lifecycle/stack-wiring.ts`). Each records a concrete,
committed seam and its honest provenance — no value here is a hidden default or a faked
capability.

### Runtime composition (stack-live)

- **Single EventV2 authority (C2, C3).** `createLifecycleDomainWiring` resolves the
  process-wide `EventV2Bridge.Service` singleton once and reaches it for every seam:
  publish (`publishLifecycleEvent`), durable page read (`readDurablePage`), durable prune
  (`pruneDurable`), and the session-owned `todo.*` publish. All four run through
  `AppRuntime.runPromise` so InstanceRef/WorkspaceRef location tagging is applied and the
  durable commit hook projects atomically (C4). No second event system, executor, or
  runtime is introduced (FR6).
- **Live Process Table feed.** One runtime `ProcessTable` is kept current by a bounded
  `EventBus.subscribeBounded` background subscription (capacity `event_bus_queue_capacity`,
  drop-oldest) folded through the idempotent projector. Because the projector dedupes by
  event id (C9), an event already applied by the emit commit hook is a no-op when the live
  feed redelivers it, so the two feeds never double-count. The subscription is scoped: the
  wiring's `dispose` interrupts the fiber and unsubscribes with no leak (AC5).
- **Startup / on-demand replay (C6).** `EventV2.readAggregate` is wired through the
  adapter's `readAggregate` seam (`readDurablePage` → normalized `LifecycleEventRecord`
  page), so `LifecyclePort.replay` rebuilds a root scope from the durable aggregate on
  demand. Cold start has no active roots to replay; the live feed is the forward-from-now
  table source, and per-root historical rebuild is invoked with a known `root_process_id`.
- **AdmissionController (C11, C17).** The real `createAdmissionController` is composed and
  reachable through the cancel `fence` seam: a first-press root cancel fences the `root`
  admission scope for that `root_process_id`, quarantining new descendant admission (AC30).
- **Watchdog cadence (C12).** The shared bucketed `createWatchdog` sweeper runs on a real
  unref'd `setInterval` at `watchdog_sweep_interval_ms`; `dispose` clears it. Leases are
  acquired by canonical executors, so until then the cadence sweeps an empty set — a real,
  idle owner, never a fabricated assessment.
- **Handoff (C16) and steer (T025).** `HandoffCoordinator` commits one durable
  `lifecycle.handoff` through the adapter emit seam; steer publishes one
  `lifecycle.steer_requested` intent through the same seam. Observation streams over the
  same bounded live subscription (per-observer capacity `subscriber_queue_capacity`, C14).
- **Operator control envelope provenance.** An operator steer/handoff/cancel event is
  authored FRESH as an operator action from the bounded, redacted Process Table row —
  never a replay of the process's own telemetry. `actor_kind` is `operator`, a new
  `correlation_id` is minted, `causation_id` is `null`, `schema_version` is the current
  version, and `hierarchy` is `null` because the bounded row does not carry the routing
  `decision_id`/`turn_id` that `HierarchyContext` requires. `kind.event_type` on the
  envelope is a descriptive origin; the authoritative event type is the EventV2 payload
  `type` set per emit. The row's original `ownership` is preserved because the projector
  advances an existing row rather than recreating it (C15, FR28, honest provenance).
- **Registration authority.** Feature 007 remains the SOLE command-registration authority
  (C19): `wireDomainPorts({ ...createLifecycleDomainPorts(port), routing: ... })` replaces
  only the `not_implemented` `process.*`/`task.*` stubs and registers no ids.

### Cancel — honest-unavailable forced-abort posture (C17)

The FIRST-press root cancel path is fully wired and real: publish one
`lifecycle.cancel_requested` per active (non-terminal) descendant resolved from the live
Process Table, plus fence the root admission scope. The SECOND-press FORCED LOCAL ABORT
drives `SessionRunCoordinator.interrupt`, which lives in the core `SessionExecution`
layer. The operator stack's `AppRuntime` provides only the opencode `Session` facade,
which neither exposes `interrupt` nor depends on `SessionExecution`, so that coordinator is
NOT reachable from `stack-live`. Rather than fake a stop, the interrupt seam records the
unavailability (a bounded debug log) and issues nothing; cancel surfaces its documented
`unconfirmed` outcome — the outcome that already means "no remote kill, reversal, or
mutation rollback is promised" (FR62, AC10, AC32). Making the forced abort real requires
exposing the `SessionExecution`/`SessionRunCoordinator` interrupt through the operator
`AppRuntime` (a composition change outside this feature's guarded scope).

### todo.* EventV2 definitions (T032)

The seven session-owned `todo.*` members (`todo.updated`, `todo.completed`, `todo.failed`,
`todo.cancelled`, `todo.stale`, `todo.rehydrated`, `todo.handoff_attached`) are each
registered as their own `EventV2.define` Definition on the `EventV2Bridge`
(`dataFields(Member.fields)`, mirroring the routing/lifecycle patterns) and published
through a new `publishTodoEvent` bridge method wired into the adapter's `TodoEventPublisher`
seam. Classification is **live** for all seven: the `TodoEvents` schema module carries no
durable annotation and never joins `durable-event-manifest.ts`, so none commits a sequence
(C4). They stay DISTINCT from the Feature 001 `todo.initialized` / `todo.completion_blocked`
events, which Feature 002 continues to consume read-only.

### TUI live seam — honest empty baseline retained

The direct-child process panel (`packages/tui/src/routes/session/process-panel/**`) is NOT
mounted into the session route (`packages/tui/src/routes/session/index.tsx`) in this pass,
and that file is deliberately NOT pulled into the guarded scope. The panel expects a
`ProcessPanelSignal` accessor whose `cards` carry model/usage/activity enrichment; the
TUI's existing session-scoped event stream delivers only the bounded, redacted lifecycle
events, and no projection into the enriched card model exists yet as a live push source.
Fabricating card enrichment from the bounded events would violate FR28. The panel therefore
keeps its documented, honest EMPTY_PROCESS_PANEL_SIGNAL baseline (a real empty state, not a
stub). The wiring point remains: render `<ProcessPanel rootSessionId={route.sessionID} />`
near `<SubagentFooter />` once a session-scoped `ProcessPanelSignal` source (the S16/T036
live card projection) is authored.
