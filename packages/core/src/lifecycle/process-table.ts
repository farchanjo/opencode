/**
 * Feature 002 / T018 (S7) — the per-root/session in-memory Process Table.
 *
 * A read-only in-memory projection over the single EventV2 authority (C2, C6):
 * it folds lifecycle event records through the idempotent projector (T016) and
 * the ten-state machine (T017), materializing one `ProcessTableRow` per process
 * and indexing rows by root process and by session for the per-root/per-session
 * topology the operator/observation surfaces read (FR26). The table is NEVER a
 * store of record and publishes nothing back onto the bus (FR18): it is rebuilt
 * on restart by replaying the durable EventV2 aggregate (the caller reads it via
 * `EventV2.readAggregate` and feeds the decoded records to `rebuild`), and
 * bounded retention is planned here and enforced against the durable aggregate by
 * the adapter through `EventV2.pruneDurable` with auditable counts (FR4, FR27).
 *
 * Purity and seams: this module performs no I/O. `rebuild` consumes an already
 * read page of records; `reconcileRestart` composes the real `Reconciliation`
 * decision (T022) against a caller-supplied owner/version resolver; `planRetention`
 * returns an auditable plan that the adapter hands to `EventV2.pruneDurable`. The
 * in-memory row carries only the projectable identity/lineage/status/hierarchy the
 * envelope bears; prompts, results, payloads, paths, secrets, and the model/usage
 * accounting enrichment (T025/T030) stay out of this row by default (FR28, C15).
 */
export * as ProcessTable from "./process-table"

import type { LifecycleEnvelope } from "@opencode-ai/schema/lifecycle/envelope"
import type {
  LeaseId,
  ParentProcessId,
  ParentSessionId,
  ProcessId,
  RootProcessId,
  RootSessionId,
  SessionId,
  TaskId,
} from "@opencode-ai/schema/lifecycle/ids"
import type {
  ActorKind,
  ProcessState,
  SettlementState,
  TerminalReason,
  Visibility,
} from "@opencode-ai/schema/lifecycle/enums"
import type {
  HierarchyRole,
  ValidationOutcome,
} from "@opencode-ai/schema/lifecycle/enums-observation"
import type { Attempt, Generation, FanoutCount } from "@opencode-ai/schema/lifecycle/values"
import type { RuntimeInstanceId } from "@opencode-ai/schema/lifecycle/ids"
import type { ReconcileRecord } from "@opencode-ai/schema/lifecycle/watchdog"
import * as StateMachine from "./state-machine"
import { createProjector } from "./projection"
import type { AnomalyRecord, LifecycleEventRecord, Projector, ProjectionOutcome } from "./projection"
import { reconcileProcess } from "./reconciliation"
import type { ReconciliationInput } from "./reconciliation"

/** A row timestamp is the decoded envelope delivery timestamp (Effect DateTimeUtc). */
type RowTimestamp = LifecycleEnvelope["delivery"]["timestamp"]

/** Parent/root relations and the session tree the process belongs to (FR26). */
export interface RowRelations {
  readonly parent_process_id: ParentProcessId | null
  readonly root_process_id: RootProcessId
  readonly session_id: SessionId
  readonly parent_session_id: ParentSessionId | null
  readonly root_session_id: RootSessionId
}

/** Attempt/generation/lease identity distinguishing re-execution of a Task (FR26). */
export interface RowIdentity {
  readonly task_id: TaskId
  readonly attempt: Attempt
  readonly generation: Generation
  readonly lease_id: LeaseId | null
}

/** Owner/runtime/scope of the row; no OS PID is ever recorded (FR7). */
export interface RowOwnership {
  readonly runtime_instance_id: RuntimeInstanceId
  readonly scope: Visibility
  readonly actor_kind: ActorKind
}

/**
 * A bounded output reference (Feature 002 / T030, C20, FR64). Feature 005 owns
 * the content plane (seal/abort/committed-byte/settlement); this row carries only
 * the opaque `OutputRef` and an optional resume `cursor` — complete output bytes
 * are NEVER loaded into the row by default (FR58). Feature 002 never resolves the
 * ref to content.
 */
export interface BoundedOutputRef {
  readonly ref: string
  readonly cursor: string | null
}

/** State/reason/settlement plus lifecycle timestamps and the bounded output ref (FR26, C20). */
export interface RowStatus {
  readonly state: ProcessState
  readonly reason: TerminalReason | null
  /**
   * Terminal-versus-settlement sub-state (C20, FR64). A `completed` row enters
   * `settling` and is NEVER marked terminal-as-successfully-settled until
   * Feature 005 reports settlement via `applySettlement` (which alone may set
   * `settled`/`unknown`/`corrupt`). Non-success terminals leave this `null`.
   */
  readonly settlement: SettlementState | null
  /** Bounded Feature 005 output reference/cursor, projected only via `applySettlement` (C20). */
  readonly output_ref: BoundedOutputRef | null
  readonly created_at: RowTimestamp
  readonly updated_at: RowTimestamp
  readonly terminal_at: RowTimestamp | null
}

/** Smart-routing hierarchy projection, present only when routing is active (C15). */
export interface RowHierarchy {
  readonly role: HierarchyRole
  readonly delegation_depth: number
  readonly route_path: ReadonlyArray<SessionId>
  readonly fanout: { readonly requested: FanoutCount; readonly granted: FanoutCount }
  readonly validation_outcome: ValidationOutcome | null
}

/** Todo-projection consistency observed on the row (Feature 002 / T032, C23-C25). */
export type TodoConsistency = "consistent" | "blocked" | "stale"

/** Aggregate Todo outcome projected onto the row; distinct from item status (C23). */
export type TodoOutcome = "completed" | "failed" | "cancelled"

/**
 * Read-only Todo projection on the row (T032, FR58k, C23-C25). The Process Table
 * OBSERVES the Session-owned Todo pointer/version/counts and never mutates any
 * Todo. It carries the bounded ref/version, bounded counts, the completion-gate
 * consistency, and the aggregate outcome only — never objective/item/handoff
 * text, which follows Feature 004 Lang Lock and is projected elsewhere (FR58m).
 */
export interface RowTodo {
  readonly todo_ref: string
  readonly todo_version: string
  readonly item_count: number
  readonly completed_count: number
  readonly pending_count: number
  readonly consistency: TodoConsistency
  readonly outcome: TodoOutcome | null
}

/**
 * The in-memory Process Table row. A structural, projectable subset of the full
 * `Row.ProcessRow` schema (T008): the identity/lineage/status/hierarchy the
 * lifecycle envelope carries, plus the surfaced projection anomalies. Model and
 * usage accounting enrichment is layered by the adapter (T025/T030) and is not
 * invented here (FR28).
 */
export interface ProcessTableRow {
  readonly id: ProcessId
  readonly identity: RowIdentity
  readonly relations: RowRelations
  readonly ownership: RowOwnership
  readonly status: RowStatus
  readonly hierarchy: RowHierarchy | null
  /** Read-only observed Todo projection, present only after a Todo event is projected (T032). */
  readonly todo: RowTodo | null
  /** Anomalies surfaced while projecting events onto this row, never invented state (C9). */
  readonly anomalies: ReadonlyArray<AnomalyRecord>
  /** Monotonic order in which the row became terminal; used for bounded retention only. */
  readonly terminal_order: number | null
}

/** The default terminal-reason projection per terminal event type (detail enriches later). */
const TERMINAL_REASON: Readonly<Partial<Record<ProcessState, TerminalReason>>> = Object.freeze({
  completed: "completed_ok",
  failed: "error",
  cancelled: "cancelled_by_root",
  zombie: "zombie",
  unknown: "owner_lost",
})

const mapHierarchy = (envelope: LifecycleEnvelope): RowHierarchy | null => {
  const h = envelope.hierarchy
  if (h === null) return null
  return {
    role: h.role,
    delegation_depth: h.delegation.depth,
    route_path: h.delegation.path,
    fanout: { requested: h.fanout.requested, granted: h.fanout.granted },
    validation_outcome: h.validation_outcome,
  }
}

/** Bounded retention policy (data-model `terminal_row_retention`, C10/FR27). */
export interface RetentionPolicy {
  /** Maximum terminal rows kept per root before the oldest are pruned. */
  readonly maxTerminalRowsPerRoot: number
}

/** The single explicit, overridable retention default (data-model Parameters, AC15/AC35). */
export const DEFAULT_RETENTION: RetentionPolicy = Object.freeze({ maxTerminalRowsPerRoot: 200 })

/** The durable-aggregate prune horizon handed to `EventV2.pruneDurable` (data-model, AC15). */
export const RETENTION_PRUNE_OLDER_THAN_MS = 3_600_000

/** An auditable retention plan: which rows to prune and the resulting counts (FR27). */
export interface RetentionAudit {
  readonly root_process_id: RootProcessId
  readonly pruned_process_ids: ReadonlyArray<ProcessId>
  readonly pruned_count: number
  readonly kept_count: number
}

/** The outcome of rebuilding the table from a replayed durable aggregate page (C6). */
export interface RebuildAudit {
  readonly applied: number
  readonly created: number
  readonly anomalies: number
}

/**
 * A settlement report from Feature 005 (T030, C20, FR64). Feature 005 is the
 * SOLE authority that may move a terminal-`completed` row out of `settling` into
 * `settled`/`unknown`/`corrupt`; Feature 002 never fabricates a settled verdict.
 * The bounded `output_ref` carries only the opaque ref + resume cursor.
 */
export interface SettlementReport {
  readonly process_id: ProcessId
  readonly settlement: SettlementState
  readonly output_ref?: BoundedOutputRef | null
}

/**
 * A read-only Todo projection patch (T032, FR58k, C23-C25). Every field except
 * `session_id` is optional so a partial signal (e.g. Feature 001
 * `todo.completion_blocked`, which carries no ref) merges onto the existing row
 * Todo without inventing a pointer. Projection is confined to `session_id`'s
 * rows — sibling Sessions are never touched (sibling isolation).
 */
export interface TodoProjectionPatch {
  readonly session_id: SessionId
  readonly todo_ref?: string
  readonly todo_version?: string
  readonly item_count?: number
  readonly completed_count?: number
  readonly pending_count?: number
  readonly consistency?: TodoConsistency
  readonly outcome?: TodoOutcome | null
}

/**
 * The Process Table: a stateful in-memory projection. Read access is `get`,
 * `rootProcesses`, and `sessionProcesses`; write access is only the event fold
 * (`applyEvent`/`rebuild`) plus restart reconciliation and retention. It never
 * publishes onto the bus (FR18).
 */
export interface ProcessTable {
  /** Fold one lifecycle event record onto the table via the projector + state machine. */
  readonly applyEvent: (record: LifecycleEventRecord) => {
    readonly outcome: ProjectionOutcome
    readonly row: ProcessTableRow | undefined
  }
  /** Rebuild by replaying an ordered durable aggregate page (from `EventV2.readAggregate`). */
  readonly rebuild: (records: Iterable<LifecycleEventRecord>) => RebuildAudit
  readonly get: (processId: ProcessId) => ProcessTableRow | undefined
  readonly rootProcesses: (rootId: RootProcessId) => ReadonlyArray<ProcessTableRow>
  readonly sessionProcesses: (sessionId: SessionId) => ReadonlyArray<ProcessTableRow>
  /**
   * After a restart replay, reconcile every non-terminal row against its durable
   * Session via the real `Reconciliation` decision (T022). Rows the resolver
   * reports without a live owner project as `unknown`/`unreconciled` with no
   * effect retry (FR39, FR40, AC13). Returns the `ReconcileRecord`s produced.
   */
  readonly reconcileRestart: (
    resolve: (row: ProcessTableRow) => Pick<ReconciliationInput, "owner_present" | "from_version" | "durable_version">,
  ) => ReadonlyArray<ReconcileRecord>
  /**
   * Project a Feature 005 settlement report onto a terminal row (T030, C20,
   * FR64). Applies only to an existing TERMINAL row; a missing or non-terminal
   * row is a no-op (`applied: false`) — a settlement verdict is never invented
   * for a still-running Task. Projects the bounded `output_ref` (ref + cursor)
   * only; complete output bytes are never loaded (FR58).
   */
  readonly applySettlement: (report: SettlementReport) => {
    readonly applied: boolean
    readonly row: ProcessTableRow | undefined
  }
  /**
   * Project a read-only Todo pointer/version/counts/consistency/outcome onto the
   * rows of ONE Session (T032, FR58k, C23-C25). Merges the patch onto each
   * matching row's existing Todo projection; no Todo aggregate is ever mutated,
   * and only `session_id`'s rows are touched (sibling isolation). Returns how
   * many rows were updated.
   */
  readonly applyTodoProjection: (patch: TodoProjectionPatch) => { readonly updated: number }
  /** Plan bounded retention for a root without mutating the table (FR27). */
  readonly planRetention: (rootId: RootProcessId, policy?: RetentionPolicy) => RetentionAudit
  /** Drop the planned rows from memory; the adapter prunes the durable aggregate separately. */
  readonly applyRetention: (audit: RetentionAudit) => void
  /** Row counts by lifecycle bucket for observation/telemetry (bounded, C18). */
  readonly snapshot: () => { readonly total: number; readonly terminal: number; readonly roots: number }
}

/** Construct a fresh, empty Process Table (C2, C6). */
export const createProcessTable = (projector: Projector = createProjector()): ProcessTable => {
  const rows = new Map<string, ProcessTableRow>()
  const byRoot = new Map<string, Set<string>>()
  const bySession = new Map<string, Set<string>>()
  let terminalCounter = 0

  const index = (map: Map<string, Set<string>>, key: string, processId: string) => {
    const set = map.get(key) ?? new Set<string>()
    set.add(processId)
    map.set(key, set)
  }

  const deindex = (map: Map<string, Set<string>>, key: string, processId: string) => {
    const set = map.get(key)
    if (!set) return
    set.delete(processId)
    if (set.size === 0) map.delete(key)
  }

  const createRow = (envelope: LifecycleEnvelope): ProcessTableRow => ({
    id: envelope.process.process_id,
    identity: {
      task_id: envelope.process.task_id,
      attempt: envelope.ordering.attempt,
      generation: envelope.ordering.generation,
      lease_id: null,
    },
    relations: {
      parent_process_id: envelope.process.parent_process_id,
      root_process_id: envelope.process.root_process_id,
      session_id: envelope.tree.session_id,
      parent_session_id: envelope.tree.parent_session_id,
      root_session_id: envelope.tree.root_session_id,
    },
    ownership: {
      runtime_instance_id: envelope.kind.runtime_instance_id,
      scope: envelope.delivery.visibility,
      actor_kind: envelope.kind.actor_kind,
    },
    status: {
      state: "created",
      reason: null,
      settlement: null,
      output_ref: null,
      created_at: envelope.delivery.timestamp,
      updated_at: envelope.delivery.timestamp,
      terminal_at: null,
    },
    hierarchy: mapHierarchy(envelope),
    todo: null,
    anomalies: [],
    terminal_order: null,
  })

  const advanceRow = (
    row: ProcessTableRow,
    envelope: LifecycleEnvelope,
    nextState: ProcessState,
  ): ProcessTableRow => {
    const becameTerminal = StateMachine.isTerminal(nextState) && !StateMachine.isTerminal(row.status.state)
    // C20/FR64: a row becoming terminal-`completed` is NOT settled — it enters
    // `settling` and waits for Feature 005 to report settlement via
    // `applySettlement`. Non-success terminals make no settlement claim (null).
    const settlement = becameTerminal && nextState === "completed" ? "settling" : row.status.settlement
    return {
      ...row,
      hierarchy: mapHierarchy(envelope) ?? row.hierarchy,
      status: {
        ...row.status,
        state: nextState,
        reason: StateMachine.isTerminal(nextState) ? (TERMINAL_REASON[nextState] ?? row.status.reason) : row.status.reason,
        settlement,
        updated_at: envelope.delivery.timestamp,
        terminal_at: becameTerminal ? envelope.delivery.timestamp : row.status.terminal_at,
      },
      terminal_order: becameTerminal ? terminalCounter++ : row.terminal_order,
    }
  }

  const withAnomaly = (row: ProcessTableRow, anomaly: AnomalyRecord): ProcessTableRow => ({
    ...row,
    anomalies: [...row.anomalies, anomaly],
  })

  const store = (row: ProcessTableRow) => {
    rows.set(row.id, row)
    index(byRoot, row.relations.root_process_id, row.id)
    index(bySession, row.relations.session_id, row.id)
  }

  const applyEvent = (record: LifecycleEventRecord) => {
    const current = rows.get(record.envelope.process.process_id)
    const outcome = projector.classify(record, current?.status.state ?? null)

    switch (outcome.kind) {
      case "created": {
        const row = createRow(record.envelope)
        store(row)
        return { outcome, row }
      }
      case "applied": {
        if (!current) return { outcome, row: undefined }
        const row = advanceRow(current, record.envelope, outcome.state)
        store(row)
        return { outcome, row }
      }
      case "duplicate":
      case "out_of_order":
        // Idempotent redelivery or a reordered durable position: the row is not
        // changed and no anomaly is attached (the drop is the correct no-op, C9).
        return { outcome, row: current }
      case "unknown_process":
        // No row exists to attach the anomaly to; it is surfaced via the outcome.
        return { outcome, row: undefined }
      case "unreconciled": {
        if (!current) return { outcome, row: undefined }
        const row = withAnomaly(current, outcome.anomaly)
        store(row)
        return { outcome, row }
      }
    }
  }

  const rebuild = (records: Iterable<LifecycleEventRecord>): RebuildAudit => {
    let applied = 0
    let created = 0
    let anomalies = 0
    for (const record of records) {
      const { outcome } = applyEvent(record)
      if (outcome.kind === "created") created++
      else if (outcome.kind === "applied") applied++
      else anomalies++
    }
    return { applied, created, anomalies }
  }

  const rowsForRoot = (rootId: RootProcessId): ProcessTableRow[] => {
    const ids = byRoot.get(rootId)
    if (!ids) return []
    const out: ProcessTableRow[] = []
    for (const id of ids) {
      const row = rows.get(id)
      if (row) out.push(row)
    }
    return out
  }

  const reconcileRestart = (
    resolve: (row: ProcessTableRow) => Pick<ReconciliationInput, "owner_present" | "from_version" | "durable_version">,
  ): ReadonlyArray<ReconcileRecord> => {
    const records: ReconcileRecord[] = []
    for (const row of rows.values()) {
      const resolved = resolve(row)
      const record = reconcileProcess({ process_id: row.id, prior_state: row.status.state, ...resolved })
      records.push(record)
      // A non-terminal row reported unknown becomes unknown/unreconciled — no
      // effect retry (FR40); reconciliation never regresses a terminal row (C13).
      if (record.outcome === "unknown" && !StateMachine.isTerminal(row.status.state)) {
        const unreconciled = withAnomaly(
          {
            ...row,
            status: { ...row.status, state: "unknown", reason: "reconciled_unknown", terminal_at: row.status.updated_at },
            terminal_order: terminalCounter++,
          },
          { kind: "unreconciled", process_id: row.id, reason: "restart_no_owner" } as AnomalyRecord,
        )
        store(unreconciled)
      }
    }
    return records
  }

  const applySettlement = (report: SettlementReport) => {
    const row = rows.get(report.process_id)
    // No row, or a non-terminal row: never invent a settlement verdict (C20).
    if (!row || !StateMachine.isTerminal(row.status.state)) return { applied: false, row }
    const settled: ProcessTableRow = {
      ...row,
      status: {
        ...row.status,
        settlement: report.settlement,
        output_ref: report.output_ref ?? row.status.output_ref,
      },
    }
    store(settled)
    return { applied: true, row: settled }
  }

  const mergeTodo = (current: RowTodo | null, patch: TodoProjectionPatch): RowTodo => ({
    todo_ref: patch.todo_ref ?? current?.todo_ref ?? "",
    todo_version: patch.todo_version ?? current?.todo_version ?? "",
    item_count: patch.item_count ?? current?.item_count ?? 0,
    completed_count: patch.completed_count ?? current?.completed_count ?? 0,
    pending_count: patch.pending_count ?? current?.pending_count ?? 0,
    consistency: patch.consistency ?? current?.consistency ?? "consistent",
    outcome: patch.outcome !== undefined ? patch.outcome : (current?.outcome ?? null),
  })

  const applyTodoProjection = (patch: TodoProjectionPatch) => {
    // Sibling isolation: only rows indexed under this Session are ever touched.
    const ids = bySession.get(patch.session_id)
    if (!ids) return { updated: 0 }
    let updated = 0
    for (const id of ids) {
      const row = rows.get(id)
      if (!row) continue
      store({ ...row, todo: mergeTodo(row.todo, patch) })
      updated++
    }
    return { updated }
  }

  const planRetention = (rootId: RootProcessId, policy: RetentionPolicy = DEFAULT_RETENTION): RetentionAudit => {
    const terminal = rowsForRoot(rootId)
      .filter((row) => StateMachine.isTerminal(row.status.state) && row.terminal_order !== null)
      .sort((a, b) => (a.terminal_order ?? 0) - (b.terminal_order ?? 0))
    const excess = terminal.length - policy.maxTerminalRowsPerRoot
    const pruned = excess > 0 ? terminal.slice(0, excess) : []
    return {
      root_process_id: rootId,
      pruned_process_ids: pruned.map((row) => row.id),
      pruned_count: pruned.length,
      kept_count: terminal.length - pruned.length,
    }
  }

  const applyRetention = (audit: RetentionAudit) => {
    for (const id of audit.pruned_process_ids) {
      const row = rows.get(id)
      if (!row) continue
      rows.delete(id)
      deindex(byRoot, row.relations.root_process_id, id)
      deindex(bySession, row.relations.session_id, id)
    }
  }

  const snapshot = () => {
    let terminal = 0
    for (const row of rows.values()) if (StateMachine.isTerminal(row.status.state)) terminal++
    return { total: rows.size, terminal, roots: byRoot.size }
  }

  return {
    applyEvent,
    rebuild,
    get: (processId) => rows.get(processId),
    rootProcesses: rowsForRoot,
    sessionProcesses: (sessionId) => {
      const ids = bySession.get(sessionId)
      if (!ids) return []
      const out: ProcessTableRow[] = []
      for (const id of ids) {
        const row = rows.get(id)
        if (row) out.push(row)
      }
      return out
    },
    reconcileRestart,
    applySettlement,
    applyTodoProjection,
    planRetention,
    applyRetention,
    snapshot,
  }
}
