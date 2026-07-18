/**
 * Feature 002 / T031 (S13) — the typed `process.*`/`task.*` domain
 * implementations backing the Feature 007 operator control plane (C19,
 * FR49–FR51).
 *
 * Feature 007 owns the command REGISTRY, authorization, CAS, idempotency, and
 * the reserved-name guard; Feature 002 supplies ONLY these typed domain query
 * and native-control implementations plus their audit events. This port never
 * registers a parallel registry and never adds output to a Message/Part/context
 * (FR51): it reads the bounded in-memory Process Table projection (T018),
 * delegates live streaming to the `ObservationPort` (T026), native root cancel
 * to the `CancelService` (T029), single-owner handoff to the `HandoffCoordinator`
 * (T028), and steer intents to the `LifecyclePort.emit` seam (T025). Every
 * method makes ZERO model calls and emits exactly one bounded, secret-free audit
 * event through the injected sink.
 *
 * Output honesty (FR28, C15, C21): the operator view projected here is the
 * bounded, redacted lifecycle/identity/status/hierarchy/settlement/todo subset
 * the Process Table row honestly carries — never prompts, results, tool
 * payloads, personal paths, secrets, or fabricated model/usage/profile fields.
 */
export * as LifecycleProcessPort from "./process-port"

import { Effect, Stream } from "effect"
import type { Scope } from "effect"
import type { ProcessTable } from "@opencode-ai/core/lifecycle/process-table"
import type { Ids } from "@opencode-ai/schema/lifecycle/ids"
import type { Values } from "@opencode-ai/schema/lifecycle/values"
import type { EnumsObservation } from "@opencode-ai/schema/lifecycle/enums-observation"
import type {
  EmitEnvelope,
  LifecycleEmitInput,
  LifecycleEmitOutput,
  LifecycleError,
  LifecycleObservation,
  ObserverPrincipal,
  OperatorPrincipal,
  ProcessError,
} from "@opencode-ai/protocol/lifecycle/commands"
import type { ObservationPort } from "@opencode-ai/protocol/lifecycle/ports"
import type { Cancel } from "@/lifecycle/cancel"
import type { Handoff } from "@/lifecycle/handoff"

// =============================================================================
// Bounded, redacted operator view (never the full schema Row — honest subset)
// =============================================================================

/**
 * The bounded operator card row Feature 002 honestly owns. It projects only the
 * lifecycle/identity/status/hierarchy/settlement/todo fields the Process Table
 * row carries; model/usage/profile enrichment is NOT invented here (FR28, C21).
 */
export interface OperatorProcessView {
  readonly processId: Ids.ProcessId
  readonly taskId: Ids.TaskId
  readonly parentProcessId: Ids.ParentProcessId | null
  readonly rootProcessId: Ids.RootProcessId
  readonly sessionId: Ids.SessionId
  readonly parentSessionId: Ids.ParentSessionId | null
  readonly rootSessionId: Ids.RootSessionId
  readonly state: ProcessTable.ProcessTableRow["status"]["state"]
  readonly reason: ProcessTable.ProcessTableRow["status"]["reason"]
  readonly settlement: ProcessTable.ProcessTableRow["status"]["settlement"]
  readonly outputRef: ProcessTable.BoundedOutputRef | null
  readonly agentKind: ProcessTable.ProcessTableRow["ownership"]["actor_kind"]
  readonly scope: ProcessTable.ProcessTableRow["ownership"]["scope"]
  readonly attempt: ProcessTable.ProcessTableRow["identity"]["attempt"]
  readonly generation: ProcessTable.ProcessTableRow["identity"]["generation"]
  readonly hierarchy: {
    readonly role: EnumsObservation.HierarchyRole
    readonly delegationDepth: number
    readonly validationOutcome: EnumsObservation.ValidationOutcome | null
  } | null
  readonly todo: ProcessTable.RowTodo | null
  readonly anomalyCount: number
}

/** One direct-child-only tree node: the view plus its direct child process ids (C22, FR58a). */
export interface OperatorProcessTreeNode {
  readonly view: OperatorProcessView
  readonly childProcessIds: ReadonlyArray<Ids.ProcessId>
}

// =============================================================================
// Audit sink (T031) — every command emits one bounded, secret-free audit event
// =============================================================================

/** A bounded, secret-free operator audit event (never a prompt/payload/path). */
export interface LifecycleAuditEvent {
  readonly commandId: string
  readonly principalId: string
  readonly target: string
  readonly outcome: "ok" | "rejected" | "not_found" | "unauthorized"
}

/** Sink the composition root wires to the Feature 007 operator audit projector. */
export interface LifecycleAuditSink {
  readonly record: (event: LifecycleAuditEvent) => Effect.Effect<void>
}

// =============================================================================
// Injected seams
// =============================================================================

/** The narrow read slice of the Process Table the port projects from (T018). */
export interface RowReader {
  readonly get: (processId: Ids.ProcessId) => ProcessTable.ProcessTableRow | undefined
  readonly rootProcesses: (rootId: Ids.RootProcessId) => ReadonlyArray<ProcessTable.ProcessTableRow>
  readonly sessionProcesses: (sessionId: Ids.SessionId) => ReadonlyArray<ProcessTable.ProcessTableRow>
}

/** The narrow steer slice of `LifecyclePort` (publishes one `lifecycle.steer_requested`, T025). */
export interface LifecycleSteerEmitter {
  readonly emit: (input: LifecycleEmitInput) => Effect.Effect<LifecycleEmitOutput, LifecycleError>
}

/**
 * Resolves a root's active cancel targets from the Process Table for the native
 * root-tree cancel path (T029). Returned by the composition root because the
 * `SessionRunCoordinator` interrupt key and per-target emit envelopes are
 * runtime state the port does not own.
 */
export type CancelTargetResolver = (
  rootProcessId: Ids.RootProcessId,
) => { readonly rootKey: string; readonly targets: ReadonlyArray<Cancel.CancelTarget> }

/** Builds the caller-supplied emit envelope for a steer intent against a row. */
export type SteerEnvelopeBuilder = (row: ProcessTable.ProcessTableRow) => EmitEnvelope

export interface LifecycleProcessPortDeps {
  readonly rows: RowReader
  readonly observation: ObservationPort
  readonly cancel: Cancel.CancelService
  readonly handoff: Handoff.HandoffCoordinator
  readonly steer: LifecycleSteerEmitter
  readonly audit: LifecycleAuditSink
  readonly resolveCancelTargets: CancelTargetResolver
  readonly buildSteerEnvelope: SteerEnvelopeBuilder
}

// =============================================================================
// Command inputs/outputs (bounded; Feature 007 owns the wire envelope)
// =============================================================================

export interface ProcessStatusInput {
  readonly processId: Ids.ProcessId
  readonly principal: OperatorPrincipal
}
export interface ProcessStatusOutput {
  readonly view: OperatorProcessView
}

export interface ProcessTreeQuery {
  readonly rootProcessId: Ids.RootProcessId
  readonly sessionId?: Ids.SessionId
  readonly principal: OperatorPrincipal
}
export interface ProcessTreeResult {
  readonly nodes: ReadonlyArray<OperatorProcessTreeNode>
}

export interface ProcessWatchInput {
  readonly processId: Ids.ProcessId
  readonly principal: ObserverPrincipal
}

export interface ProcessCancelCommand {
  readonly processId: Ids.ProcessId
  readonly reason: Values.Reason | null
  readonly principal: OperatorPrincipal
}
export interface ProcessCancelResult {
  readonly outcome: EnumsObservation.CancelOutcome
  readonly auditId: string
}

export interface ProcessSteerCommand {
  readonly processId: Ids.ProcessId
  readonly reason: Values.Reason | null
  readonly principal: OperatorPrincipal
}
export interface ProcessSteerResult {
  readonly eventId: string
}

export interface ProcessHandoffCommand {
  readonly sourceProcessId: Ids.ProcessId
  readonly target: { readonly sessionId: Ids.SessionId; readonly processId: Ids.ProcessId }
  readonly reason: Values.Reason
  readonly generation: Values.Generation
  readonly principal: OperatorPrincipal
}
export interface ProcessHandoffResult {
  readonly eventId: string
}

export interface TaskStatusInput {
  readonly taskId: Ids.TaskId
  readonly rootProcessId: Ids.RootProcessId
  readonly principal: OperatorPrincipal
}
export interface TaskStatusOutput {
  readonly views: ReadonlyArray<OperatorProcessView>
}

/**
 * The typed domain port. Method names mirror the reserved command leaves; the
 * command adapter (`lifecycle-command-port.ts`) maps `process.*`/`task.*` ids to
 * these calls. `watch` returns a scoped, leak-free `Stream` (the CLI/TUI attach
 * it directly); the command adapter surfaces a bounded initial frame.
 */
export interface LifecycleProcessPort {
  readonly status: (input: ProcessStatusInput) => Effect.Effect<ProcessStatusOutput, ProcessError>
  readonly tree: (input: ProcessTreeQuery) => Effect.Effect<ProcessTreeResult, ProcessError>
  readonly watch: (
    input: ProcessWatchInput,
  ) => Effect.Effect<Stream.Stream<LifecycleObservation, never>, ProcessError, Scope.Scope>
  readonly cancel: (input: ProcessCancelCommand) => Effect.Effect<ProcessCancelResult, ProcessError>
  readonly steer: (input: ProcessSteerCommand) => Effect.Effect<ProcessSteerResult, ProcessError>
  readonly handoff: (input: ProcessHandoffCommand) => Effect.Effect<ProcessHandoffResult, ProcessError>
  readonly taskStatus: (input: TaskStatusInput) => Effect.Effect<TaskStatusOutput, ProcessError>
  readonly taskTree: (input: ProcessTreeQuery) => Effect.Effect<ProcessTreeResult, ProcessError>
  readonly taskCancel: (input: ProcessCancelCommand) => Effect.Effect<ProcessCancelResult, ProcessError>
}

// =============================================================================
// Bounded, redacted projection
// =============================================================================

/** Project one Process Table row onto the bounded, redacted operator view (FR28). */
export function toOperatorView(row: ProcessTable.ProcessTableRow): OperatorProcessView {
  return {
    processId: row.id,
    taskId: row.identity.task_id,
    parentProcessId: row.relations.parent_process_id,
    rootProcessId: row.relations.root_process_id,
    sessionId: row.relations.session_id,
    parentSessionId: row.relations.parent_session_id,
    rootSessionId: row.relations.root_session_id,
    state: row.status.state,
    reason: row.status.reason,
    settlement: row.status.settlement,
    outputRef: row.status.output_ref,
    agentKind: row.ownership.actor_kind,
    scope: row.ownership.scope,
    attempt: row.identity.attempt,
    generation: row.identity.generation,
    hierarchy: row.hierarchy
      ? {
          role: row.hierarchy.role,
          delegationDepth: row.hierarchy.delegation_depth,
          validationOutcome: row.hierarchy.validation_outcome,
        }
      : null,
    todo: row.todo,
    anomalyCount: row.anomalies.length,
  }
}

// =============================================================================
// Factory
// =============================================================================

const AUDIT_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
function auditId(): string {
  let rand = ""
  for (let i = 0; i < 16; i++) rand += AUDIT_ID_ALPHABET[Math.floor(Math.random() * 32)]
  return `evt_opaudit_${rand}`
}

function notFound(processId: string): ProcessError {
  return { type: "not_found", processId }
}

/** Build the direct-child-only tree over a set of rows (each node lists direct children only). */
function buildTree(rows: ReadonlyArray<ProcessTable.ProcessTableRow>): ReadonlyArray<OperatorProcessTreeNode> {
  const childrenByParent = new Map<string, Ids.ProcessId[]>()
  for (const row of rows) {
    const parent = row.relations.parent_process_id
    if (parent === null) continue
    const list = childrenByParent.get(parent) ?? []
    list.push(row.id)
    childrenByParent.set(parent, list)
  }
  return rows.map((row) => ({
    view: toOperatorView(row),
    childProcessIds: childrenByParent.get(row.id) ?? [],
  }))
}

export function createLifecycleProcessPort(deps: LifecycleProcessPortDeps): LifecycleProcessPort {
  const emitAudit = (event: LifecycleAuditEvent) => deps.audit.record(event)

  const status = (input: ProcessStatusInput): Effect.Effect<ProcessStatusOutput, ProcessError> =>
    Effect.gen(function* () {
      const row = deps.rows.get(input.processId)
      if (row === undefined) {
        yield* emitAudit({ commandId: "process.status", principalId: input.principal.id, target: input.processId, outcome: "not_found" })
        return yield* Effect.fail<ProcessError>(notFound(input.processId))
      }
      yield* emitAudit({ commandId: "process.status", principalId: input.principal.id, target: input.processId, outcome: "ok" })
      return { view: toOperatorView(row) }
    })

  const treeFor = (
    commandId: string,
    input: ProcessTreeQuery,
  ): Effect.Effect<ProcessTreeResult, ProcessError> =>
    Effect.gen(function* () {
      // Direct-child-only projection for a Session view when addressed (FR58a),
      // otherwise the full root topology (still direct-child-only per node).
      const rows =
        input.sessionId !== undefined
          ? deps.rows.sessionProcesses(input.sessionId)
          : deps.rows.rootProcesses(input.rootProcessId)
      yield* emitAudit({
        commandId,
        principalId: input.principal.id,
        target: input.sessionId ?? input.rootProcessId,
        outcome: "ok",
      })
      return { nodes: buildTree(rows) }
    })

  const watch = (
    input: ProcessWatchInput,
  ): Effect.Effect<Stream.Stream<LifecycleObservation, never>, ProcessError, Scope.Scope> =>
    Effect.gen(function* () {
      const row = deps.rows.get(input.processId)
      if (row === undefined) return yield* Effect.fail<ProcessError>(notFound(input.processId))
      // Delegate live streaming to the scoped, leak-free observation surface
      // (C14, FR15); map its authorization error onto the process error union.
      const stream = yield* deps.observation
        .observeProcess({ processId: input.processId, principal: input.principal })
        .pipe(Effect.mapError((error): ProcessError => observationToProcessError(error)))
      return stream
    })

  const cancelRoot = (
    commandId: string,
    input: ProcessCancelCommand,
  ): Effect.Effect<ProcessCancelResult, ProcessError> =>
    Effect.gen(function* () {
      const row = deps.rows.get(input.processId)
      if (row === undefined) {
        yield* emitAudit({ commandId, principalId: input.principal.id, target: input.processId, outcome: "not_found" })
        return yield* Effect.fail<ProcessError>(notFound(input.processId))
      }
      const rootProcessId = row.relations.root_process_id
      const resolved = deps.resolveCancelTargets(rootProcessId)
      const id = auditId()
      const out = yield* deps.cancel
        .requestRootCancel({
          rootProcessId,
          rootKey: resolved.rootKey,
          principal: input.principal,
          reason: input.reason,
          targets: resolved.targets,
        })
        .pipe(Effect.mapError((error): ProcessError => ({ type: "unavailable", reason: lifecycleErrorReason(error) })))
      yield* emitAudit({
        commandId,
        principalId: input.principal.id,
        target: input.processId,
        outcome: out.outcome === "rejected" ? "rejected" : "ok",
      })
      return { outcome: out.outcome, auditId: id }
    })

  const steer = (input: ProcessSteerCommand): Effect.Effect<ProcessSteerResult, ProcessError> =>
    Effect.gen(function* () {
      const row = deps.rows.get(input.processId)
      if (row === undefined) {
        yield* emitAudit({ commandId: "process.steer", principalId: input.principal.id, target: input.processId, outcome: "not_found" })
        return yield* Effect.fail<ProcessError>(notFound(input.processId))
      }
      const out = yield* deps.steer
        .emit({
          envelope: deps.buildSteerEnvelope(row),
          eventType: "lifecycle.steer_requested",
          data: { outcome: "requested", reason: input.reason ?? "operator_steer" },
        })
        .pipe(Effect.mapError((error): ProcessError => ({ type: "unavailable", reason: lifecycleErrorReason(error) })))
      yield* emitAudit({ commandId: "process.steer", principalId: input.principal.id, target: input.processId, outcome: "ok" })
      return { eventId: out.eventId }
    })

  const handoff = (input: ProcessHandoffCommand): Effect.Effect<ProcessHandoffResult, ProcessError> =>
    Effect.gen(function* () {
      const row = deps.rows.get(input.sourceProcessId)
      if (row === undefined) {
        yield* emitAudit({ commandId: "process.handoff", principalId: input.principal.id, target: input.sourceProcessId, outcome: "not_found" })
        return yield* Effect.fail<ProcessError>(notFound(input.sourceProcessId))
      }
      const out = yield* deps.handoff
        .handoff({
          // The source row's emit envelope selects the durable aggregate the one
          // single-owner handoff event commits to (T028, C16).
          envelope: deps.buildSteerEnvelope(row),
          source: { sessionId: row.relations.session_id, processId: row.id },
          target: { sessionId: input.target.sessionId, processId: input.target.processId },
          reason: input.reason,
          generation: input.generation,
        })
        .pipe(Effect.mapError((error): ProcessError => ({ type: "unavailable", reason: lifecycleErrorReason(error) })))
      yield* emitAudit({
        commandId: "process.handoff",
        principalId: input.principal.id,
        target: input.sourceProcessId,
        outcome: "ok",
      })
      return { eventId: out.eventId }
    })

  const taskStatus = (input: TaskStatusInput): Effect.Effect<TaskStatusOutput, ProcessError> =>
    Effect.gen(function* () {
      // Resolve a logical Task to its process/attempt/generation set within the
      // root topology; zero model calls (FR50, T035).
      const views = deps.rows
        .rootProcesses(input.rootProcessId)
        .filter((row) => row.identity.task_id === input.taskId)
        .map(toOperatorView)
      yield* emitAudit({ commandId: "task.status", principalId: input.principal.id, target: input.taskId, outcome: views.length > 0 ? "ok" : "not_found" })
      if (views.length === 0) return yield* Effect.fail<ProcessError>(notFound(input.taskId))
      return { views }
    })

  return {
    status,
    tree: (input) => treeFor("process.tree", input),
    watch,
    cancel: (input) => cancelRoot("process.cancel", input),
    steer,
    handoff,
    taskStatus,
    taskTree: (input) => treeFor("task.tree", input),
    taskCancel: (input) => cancelRoot("task.cancel", input),
  }
}

// =============================================================================
// Error mapping helpers
// =============================================================================

function lifecycleErrorReason(error: LifecycleError): string {
  switch (error.type) {
    case "unknown_event_type":
      return `unknown event type ${error.eventType}`
    case "validation_failed":
      return "validation failed"
    case "second_authority_rejected":
      return error.reason
    case "unavailable":
      return error.reason
    case "not_implemented":
      return "not implemented"
  }
}

function observationToProcessError(error: {
  readonly type: "unauthorized" | "sibling_leak_rejected" | "invalid_filter" | "unavailable" | "not_implemented"
  readonly reason?: string
}): ProcessError {
  switch (error.type) {
    case "unauthorized":
    case "sibling_leak_rejected":
      return { type: "unauthorized", reason: error.reason ?? error.type }
    case "invalid_filter":
      return { type: "invalid_argument", field: "filter", reason: error.reason ?? "invalid filter" }
    case "unavailable":
      return { type: "unavailable", reason: error.reason ?? "unavailable" }
    case "not_implemented":
      return { type: "not_implemented" }
  }
}
