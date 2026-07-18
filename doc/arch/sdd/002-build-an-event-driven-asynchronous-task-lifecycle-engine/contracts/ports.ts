/**
 * Feature 002 — Application Ports (Task Lifecycle Engine)
 *
 * These interfaces define the inbound ports owned by Feature 002. They are
 * implemented by the lifecycle domain engine (`packages/core/src/lifecycle/**`)
 * and application adapters (`packages/opencode/src/lifecycle/**`), and are
 * consumed by Feature 007 operator control-plane adapters (CLI/TUI/App) per
 * ADR-0003. Feature 002 never registers a parallel command registry (C19).
 *
 * Domain: lifecycle event publication/projection, Process Table observation,
 * process/task operator queries and native control commands. All mutations
 * (cancel/reconcile) require an operator principal, use canonical services,
 * and publish audit events; observation is read-only and never mutates
 * lifecycle state (FR16–FR18, FR51).
 *
 * Wire-shape source of truth: `doc/arch/schemas/lifecycle/*.cue`
 * (envelope.cue, events.cue, process-row.cue, enums.cue, ids.cue, usage.cue,
 * observation.cue). This file is the TypeScript mirror; it does not redefine
 * event payload schemas owned by `packages/schema/src/lifecycle/*`.
 */

import type { Effect, Scope, Stream } from "effect"

// =============================================================================
// Shared identifiers (wire shape: doc/arch/schemas/lifecycle/ids.cue)
// =============================================================================

/** Logical Task identity. One `TaskId` maps to N `ProcessId` attempts (C8, FR7). */
export type TaskId = string

/**
 * Observable attempt/execution identity. NEVER an operating system PID; implies
 * no OS isolation or kill semantics (FR7, AC19).
 */
export type ProcessId = string

export type ParentProcessId = string
export type RootProcessId = string
export type RuntimeInstanceId = string
export type LeaseId = string
export type SessionId = string

// =============================================================================
// Closed enums (wire shape: doc/arch/schemas/lifecycle/enums.cue)
// =============================================================================

/**
 * The ten permitted Process Table states (C7, FR25). `handoff` is an event,
 * never a state. `completed` | `failed` | `cancelled` | `zombie` | `unknown`
 * are absorbing except for bounded retention cleanup.
 */
export type ProcessState =
  | "created"
  | "queued"
  | "waiting"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "zombie"
  | "unknown"

/**
 * Cancellation outcomes (C17, FR41, AC10, AC32). Local abort is distinct from
 * effective remote cancellation; no remote kill, reversal, or mutation
 * rollback is ever promised.
 */
export type CancelOutcome = "requested" | "accepted" | "rejected" | "unknown" | "unconfirmed"

/**
 * Bounded terminal classification retained on a terminal row (FR27). Distinct
 * from `ProcessState`; explains why a terminal state was reached.
 */
export type TerminalReason =
  | "normal_completion"
  | "task_error"
  | "cancel_requested"
  | "owner_lost"
  | "zombie_timeout"
  | "reconciliation_unknown"

/**
 * Terminal-versus-settlement sub-state (C20). A Task is never marked
 * terminal-as-successfully-settled until Feature 005 reports settlement.
 */
export type SettlementState = "unsettled" | "settling" | "settled" | "unknown" | "corrupt"

/** Live usage provenance (C21): whether the figure is an estimate or a reported value. */
export type UsageProvenance = "estimated" | "reported"

/** Live usage source (C21): which layer produced the figure. */
export type UsageSource = "provider" | "runtime" | "local-estimate"

/** Hierarchical role reused verbatim from Feature 001 / ADR-0002 (C15). */
export type HierarchyRole = "architect" | "manager" | "worker"

/** Validation outcome reused verbatim from Feature 001 `hierarchy.validation` (C15). */
export type ValidationOutcome = "passed" | "failed" | "low_confidence" | "escalated"

/** Publishing agent kind carried on every envelope (FR9). */
export type AgentKind = "architect" | "manager" | "worker" | "subagent" | "primary"

/** Publishing actor kind carried on every envelope (FR9). */
export type ActorKind = "runtime" | "operator" | "executor"

/** Delivery visibility scope carried on every envelope (FR9, FR11). */
export type Visibility = "session" | "tree" | "global-privileged"

/** Allowlisted bounded activity kinds rendered on a live card (FR56, AC28). */
export type ActivityKind = "read" | "edit" | "run_command" | "waiting" | "generating" | "other"

// =============================================================================
// Lifecycle event vocabulary (wire shape: doc/arch/schemas/lifecycle/events.cue)
// =============================================================================

/**
 * Durable event classes: carry the EventV2 `durable {version, aggregate}`
 * annotation and replay through `EventV2.readAggregate` (C4). Semantic
 * checkpoints and terminal transitions; never coalesced or dropped (FR36, C5).
 */
export const DURABLE_LIFECYCLE_EVENT_TYPES = [
  "admitted",
  "parent_attached",
  "process_created",
  "started",
  "handoff",
  "completed",
  "failed",
  "cancelled",
  "zombie_detected",
  "reconciled",
  "owner_lost",
] as const

/**
 * Live event classes: omit `durable` (no sequence, no replay) (C4). Deltas,
 * progress, and control-intent transitions; only these are sampling/coalescing
 * targets (FR36).
 */
export const LIVE_LIFECYCLE_EVENT_TYPES = [
  "queued",
  "waiting",
  "promoted",
  "extended",
  "steer_requested",
  "steer_accepted",
  "steer_rejected",
  "turn_started",
  "turn_ended",
  "turn_failed",
  "tool_called",
  "tool_settled",
  "cancel_requested",
  "cancelling",
  "unknown",
] as const

export type DurableLifecycleEventType = (typeof DURABLE_LIFECYCLE_EVENT_TYPES)[number]
export type LiveLifecycleEventType = (typeof LIVE_LIFECYCLE_EVENT_TYPES)[number]

/** The 26-member closed lifecycle event vocabulary (FR20). */
export type LifecycleEventType = DurableLifecycleEventType | LiveLifecycleEventType

// =============================================================================
// Lifecycle envelope (wire shape: doc/arch/schemas/lifecycle/envelope.cue)
// =============================================================================

/**
 * Common fields carried by every lifecycle event (FR9), all bounded and
 * redacted (FR13). Hierarchy fields are present only when Smart hierarchical
 * routing is active and are reused verbatim from Feature 001 (C15).
 */
export interface LifecycleEnvelope {
  readonly eventId: string // EventV2 evt_ id, assigned by EventV2 (C8)
  readonly eventType: LifecycleEventType
  readonly schemaVersion: number // EventV2 durable.version for durable classes (C4)
  readonly rootSessionId: SessionId
  readonly sessionId: SessionId
  readonly parentSessionId: SessionId | null
  readonly taskId: TaskId
  readonly processId: ProcessId
  readonly parentProcessId: ParentProcessId | null
  readonly rootProcessId: RootProcessId
  readonly agentKind: AgentKind
  readonly actorKind: ActorKind
  readonly runtimeInstanceId: RuntimeInstanceId
  readonly sequence: number // per-aggregate ordering only; no global order (FR10, C8)
  readonly correlationId: string
  readonly causationId: string | null
  readonly visibility: Visibility
  readonly timestamp: string // ISO-8601
  readonly attempt: number
  readonly generation: number
  readonly metadata: Readonly<Record<string, unknown>> // redacted; no prompts/results/tool payloads/paths/secrets (FR13)
  // Present only when Smart hierarchical routing is active (reused verbatim, C15):
  readonly hierarchyRole: HierarchyRole | null
  readonly delegationDepth: number | null
  readonly delegationPath: readonly string[] | null
  readonly fanoutRequested: number | null
  readonly fanoutGranted: number | null
  readonly validationOutcome: ValidationOutcome | null
  readonly decisionId: string | null // from Feature 001 routing.decision
  readonly turnId: string | null
}

// =============================================================================
// Live usage (wire shape: doc/arch/schemas/lifecycle/usage.cue)
// =============================================================================

/**
 * Live usage carries provenance and source; missing usage is an explicit
 * unavailable state, never a fabricated zero (C21, FR55, AC25). Unknown token
 * fields are never summed; `tokensPerSecond` is valid only from monotonic
 * elapsed time and known token counts.
 */
export type LiveUsage =
  | { readonly available: false }
  | {
      readonly available: true
      readonly provenance: UsageProvenance
      readonly source: UsageSource
      readonly inputTokens: number | null
      readonly outputTokens: number | null
      readonly reasoningTokens: number | null
      readonly cacheReadTokens: number | null
      readonly cacheWriteTokens: number | null
      readonly cost: number | null
      readonly tokensPerSecond: number | null
      readonly elapsedMs: number // monotonic
    }

// =============================================================================
// Bounded output reference (Feature 005 owns the content-plane contract)
// =============================================================================

/** Bounded cursor/reference only; complete output is never loaded by default (FR58, C20). */
export interface BoundedOutputRef {
  readonly ref: string // opaque Feature 005 OutputRef; Feature 002 never resolves content
  readonly cursor: string | null
}

// =============================================================================
// Process Table row (wire shape: doc/arch/schemas/lifecycle/process-row.cue)
// =============================================================================

/**
 * Read-only projection row (FR4, FR26). Rebuilt via replay; never a source
 * from which events are reconstructed. Prompts, complete results, tool
 * payloads, personal paths, and secrets stay outside rows by default (FR28).
 */
export interface ProcessRow {
  readonly taskId: TaskId
  readonly processId: ProcessId
  readonly parentProcessId: ParentProcessId | null
  readonly rootProcessId: RootProcessId
  readonly sessionId: SessionId
  readonly rootSessionId: SessionId
  readonly ownerRuntimeInstanceId: RuntimeInstanceId | null
  readonly status: ProcessState
  readonly terminalReason: TerminalReason | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly terminalAt: string | null
  readonly attempt: number
  readonly generation: number
  readonly leaseId: LeaseId | null
  readonly leaseExpiresAt: string | null
  readonly agentKind: AgentKind
  readonly taskClass: string
  readonly profile: string
  readonly effort: string
  readonly provider: string | null
  readonly model: string | null
  readonly variant: string | null
  readonly dependencies: readonly ProcessId[]
  readonly childProcessIds: readonly ProcessId[]
  readonly pendingInputs: number
  readonly pendingSteers: number
  readonly cancelOutcome: CancelOutcome | null
  readonly exitReason: string | null
  readonly error: string | null // bounded, redacted
  readonly usage: LiveUsage
  readonly ttftMs: number | null
  readonly streamDurationMs: number | null
  readonly totalDurationMs: number | null
  readonly traceId: string | null
  readonly spanId: string | null
  readonly settlementState: SettlementState
  readonly outputRef: BoundedOutputRef | null
  readonly todoRef: string | null // observed only; never mutated (C25, FR58k)
  readonly todoVersion: string | null
  // Present only when Smart hierarchical routing is active (C15, C26):
  readonly hierarchyRole: HierarchyRole | null
  readonly delegationDepth: number | null
  readonly delegationPath: readonly string[] | null
  readonly selectedRoutePath: string | null
  readonly fanoutRequested: number | null
  readonly fanoutGranted: number | null
  readonly validationOutcome: ValidationOutcome | null
}

// =============================================================================
// Observation payload (wire shape: doc/arch/schemas/lifecycle/observation.cue)
// =============================================================================

/** A projection anomaly surfaced without inventing lifecycle state (FR29, C9). */
export type ProjectionAnomaly =
  | { readonly kind: "duplicate"; readonly eventId: string }
  | { readonly kind: "out_of_order"; readonly aggregateID: string; readonly expectedSeq: number; readonly actualSeq: number }
  | { readonly kind: "unknown_process"; readonly processId: ProcessId }
  | { readonly kind: "unreconciled"; readonly processId: ProcessId }

/** One delivered lifecycle observation (FR14). Redacted before delivery (FR13, FR28). */
export interface LifecycleObservation {
  readonly envelope: LifecycleEnvelope
  readonly data: Readonly<Record<string, unknown>>
  readonly anomaly: ProjectionAnomaly | null
}

export type ObservationScope = "session" | "process" | "tree" | "global"

// =============================================================================
// Principals
// =============================================================================

/**
 * Feature 007 operator principals permitted to view cards, expand OutputRef
 * cursors, or request root cancellation (C19).
 */
export interface OperatorPrincipal {
  readonly kind: "operator" | "manager-view"
  readonly id: string
}

/** Non-operator observer principals bound by session/tree scope (FR11). */
export type ObserverPrincipal =
  | { readonly kind: "main-context"; readonly rootSessionId: SessionId }
  | { readonly kind: "agent"; readonly sessionId: SessionId }
  | { readonly kind: "subagent"; readonly sessionId: SessionId }
  | OperatorPrincipal

// =============================================================================
// LifecyclePort — emit / project / replay
// =============================================================================

/**
 * Domain-internal port used by canonical executors, the projector, and the
 * restart/reconciliation seam. Never called by an Observable or the Process
 * Table itself (FR17, FR18, C11). EventV2 remains the single event authority;
 * this port is the bounded adaptation layer over it (C2, C3).
 */
export interface LifecyclePort {
  /**
   * Publish one lifecycle event through the canonical EventV2 bridge
   * (`publishLifecycleEvent` on `packages/opencode/src/event-v2-bridge.ts`,
   * mirroring `publishRoutingEvent`). Only canonical executors call this.
   * Durable events commit atomically via `EventV2.PublishOptions.commit(seq)`;
   * live events publish without a sequence (C4). Wire shape: events.cue.
   */
  readonly emit: (input: LifecycleEmitInput) => Effect.Effect<LifecycleEmitOutput, LifecycleError>

  /**
   * Apply one durable or live lifecycle event to the in-memory Process Table
   * projection. Idempotent, keyed on event id plus `(aggregateID, seq)` (C9,
   * FR23). Duplicate/out-of-order/unknown events are observable anomalies,
   * never a thrown error and never an invented terminal state (FR29).
   */
  readonly project: (input: LifecycleProjectInput) => Effect.Effect<LifecycleProjectOutput, LifecycleError>

  /**
   * Rebuild a Process Table scope (root or session) by replaying the EventV2
   * durable aggregate via `EventV2.readAggregate` and reconciling against
   * durable Sessions (C6, C13). Used on restart and on explicit
   * `ProcessPort.reconcile`. Rows without a live owner project as
   * `unknown`/`unreconciled`; no automatic effect retry (FR39, FR40, AC13).
   */
  readonly replay: (input: LifecycleReplayInput) => Effect.Effect<LifecycleReplayOutput, LifecycleError>
}

export interface LifecycleEmitInput {
  readonly envelope: Omit<LifecycleEnvelope, "eventId" | "timestamp" | "sequence">
  readonly eventType: LifecycleEventType
  readonly data: Readonly<Record<string, unknown>> // schema-validated by the event Definition; redacted (FR13)
}

export interface LifecycleEmitOutput {
  readonly eventId: string // EventV2 evt_ id (C8)
  readonly durable: { readonly aggregateID: string; readonly seq: number; readonly version: number } | null
}

export interface LifecycleProjectInput {
  readonly eventId: string
  readonly eventType: LifecycleEventType
  readonly envelope: LifecycleEnvelope
  readonly data: Readonly<Record<string, unknown>>
  readonly durable: { readonly aggregateID: string; readonly seq: number } | null
}

export interface LifecycleProjectOutput {
  readonly applied: boolean // false when a duplicate/anomaly was detected and no state changed
  readonly anomaly: ProjectionAnomaly | null
  readonly row: ProcessRow | null
}

export interface LifecycleReplayInput {
  readonly scope: "root" | "session"
  readonly scopeId: string
  readonly after?: number // resume cursor, mirrors EventV2.readAggregate `after`
  readonly limit: number
}

export interface LifecycleReplayOutput {
  readonly rows: readonly ProcessRow[]
  readonly hasMore: boolean
  readonly cursor: number | null
  readonly reconciledCount: number
  readonly unreconciledCount: number
}

export type LifecycleError =
  | { readonly type: "unknown_event_type"; readonly eventType: string }
  | { readonly type: "validation_failed"; readonly fields: Record<string, string> }
  | { readonly type: "second_authority_rejected"; readonly reason: string } // guards FR6/AC22
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// ProcessPort — list / show / tree / observe / cancel / reconcile
// =============================================================================

/**
 * Operator-facing port backing the Feature 007 `process.*`/`task.*` command
 * IDs (C19). Feature 002 supplies only these typed domain implementations;
 * Feature 007 owns registration, authorization, CAS, idempotency, and audit.
 */
export interface ProcessPort {
  /** List processes within an authorized scope with bounded filters. Zero LLM calls. */
  readonly list: (input: ProcessListInput) => Effect.Effect<ProcessListOutput, ProcessError>

  /** Redacted single-process status: attempt, owner, model, timing, cost (`process.status`/`task.status`). */
  readonly show: (input: ProcessShowInput) => Effect.Effect<ProcessShowOutput, ProcessError>

  /**
   * Authorized root/session process tree, direct-child-only per Session view
   * (`process.tree`/`task.tree`, C22, FR58a). `ProcessTreeNode.childProcessIds`
   * lists direct children only at each projection level.
   */
  readonly tree: (input: ProcessTreeInput) => Effect.Effect<ProcessTreeOutput, ProcessError>

  /**
   * Live lifecycle stream for one process/task (`process.watch`/`task.watch`).
   * Delegates to `ObservationPort.observeProcess`; exposed here as the
   * Feature 007 command signature. Scoped, leak-free (C14, FR15).
   */
  readonly observe: (
    input: ProcessObserveInput,
  ) => Effect.Effect<Stream.Stream<LifecycleObservation, never>, ProcessError, Scope.Scope>

  /**
   * Native cancel request through canonical services (`process.cancel`/
   * `task.cancel`). Publishes audit + lifecycle events; never mutates the
   * Process Table directly (C17, FR51).
   */
  readonly cancel: (input: ProcessCancelInput) => Effect.Effect<ProcessCancelOutput, ProcessError>

  /**
   * Trigger explicit versioned reconciliation against durable Sessions for a
   * root or session scope (C13). Operator-only; no automatic retry of
   * effects is implied.
   */
  readonly reconcile: (input: ProcessReconcileInput) => Effect.Effect<ProcessReconcileOutput, ProcessError>
}

export interface ProcessListInput {
  readonly scope: ObservationScope
  readonly scopeId: string
  readonly states?: readonly ProcessState[]
  readonly limit: number
  readonly cursor?: string
}

export interface ProcessListOutput {
  readonly rows: readonly ProcessRow[]
  readonly cursor: string | null
}

export interface ProcessShowInput {
  readonly processId: ProcessId
}

export interface ProcessShowOutput {
  readonly row: ProcessRow
}

export interface ProcessTreeInput {
  readonly rootProcessId: RootProcessId
  readonly sessionId?: SessionId // when set, direct-child-only projection for that Session view (FR58a)
}

export interface ProcessTreeNode {
  readonly row: ProcessRow
  readonly childProcessIds: readonly ProcessId[] // direct children only at this projection level
}

export interface ProcessTreeOutput {
  readonly nodes: readonly ProcessTreeNode[]
}

export interface ProcessObserveInput {
  readonly processId: ProcessId
  readonly principal: ObserverPrincipal
}

export interface ProcessCancelInput {
  readonly processId: ProcessId
  readonly reason: string | null
  readonly principal: OperatorPrincipal
}

export interface ProcessCancelOutput {
  readonly outcome: CancelOutcome
  readonly auditId: string
}

export interface ProcessReconcileInput {
  readonly scope: "root" | "session"
  readonly scopeId: string
  readonly principal: OperatorPrincipal
}

export interface ProcessReconcileOutput {
  readonly reconciledCount: number
  readonly unreconciledCount: number
}

export type ProcessError =
  | { readonly type: "not_found"; readonly processId: string }
  | { readonly type: "unauthorized"; readonly reason: string }
  | { readonly type: "cancel_rejected"; readonly processId: string; readonly reason: string }
  | { readonly type: "invalid_argument"; readonly field: string; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// ObservationPort — observeSession / observeProcess / observeTree / observeGlobal (C14)
// =============================================================================

/**
 * Read-only typed observation API over Effect Stream/PubSub with scoped
 * finalizers (FR14, FR15). The canonical Permission/Policy authority applies
 * authorization, filtering, and redaction before delivery; sibling and
 * cross-project leakage is a failure (FR11, FR12, AC3, AC4).
 */
export interface ObservationPort {
  /** Stream of a single Session's lifecycle events. */
  readonly observeSession: (
    input: ObserveSessionInput,
  ) => Effect.Effect<Stream.Stream<LifecycleObservation, never>, ObservationError, Scope.Scope>

  /** Stream of one process's attempt events. */
  readonly observeProcess: (
    input: ObserveProcessInput,
  ) => Effect.Effect<Stream.Stream<LifecycleObservation, never>, ObservationError, Scope.Scope>

  /** Stream of an authorized root tree; visibility filtered before delivery. */
  readonly observeTree: (
    input: ObserveTreeInput,
  ) => Effect.Effect<Stream.Stream<LifecycleObservation, never>, ObservationError, Scope.Scope>

  /** Privileged operational stream with redaction; requires an operator principal (FR11, Security 1). */
  readonly observeGlobal: (
    input: ObserveGlobalInput,
  ) => Effect.Effect<Stream.Stream<LifecycleObservation, never>, ObservationError, Scope.Scope>
}

export interface ObserveSessionInput {
  readonly sessionId: SessionId
  readonly principal: ObserverPrincipal
}

export interface ObserveProcessInput {
  readonly processId: ProcessId
  readonly principal: ObserverPrincipal
}

export interface ObserveTreeInput {
  readonly rootSessionId: SessionId
  readonly principal: ObserverPrincipal
}

export interface GlobalObservationFilter {
  readonly states?: readonly ProcessState[]
  readonly hierarchyRoles?: readonly HierarchyRole[]
  readonly agentKinds?: readonly AgentKind[]
  readonly limit: number
}

export interface ObserveGlobalInput {
  readonly filter: GlobalObservationFilter
  readonly principal: OperatorPrincipal
}

export type ObservationError =
  | { readonly type: "unauthorized"; readonly reason: string }
  | { readonly type: "sibling_leak_rejected"; readonly reason: string } // guards AC3/AC4
  | { readonly type: "invalid_filter"; readonly field: string; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }
