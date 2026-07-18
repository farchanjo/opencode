/**
 * Feature 003 / T033 — in-process test fixtures for the jobs application layer.
 *
 * Pure builders and in-memory fakes: no Bun runtime, database, HTTP server, or
 * live scheduler, so the trigger service (T023), notification service (T024),
 * persistence adapter (T022), authorization (T025), and the `jobs.*` operator
 * command port (T027) exercise their real logic against injected seams. Mirrors
 * `packages/opencode/test/lifecycle/fixtures.ts`.
 */
import { Effect, Schema } from "effect"
import { Definition } from "@opencode-ai/schema/jobs/definition"
import { Reconciliation } from "@opencode-ai/schema/jobs/reconciliation"
import type { Overlap } from "@opencode-ai/core/jobs/overlap"
import type {
  JobDefinitionSummary,
  Occurrence,
  NotificationEnvelope,
} from "@opencode-ai/protocol/jobs/commands"
import type {
  AdmissionOutcome,
  AssociatedProcess,
  JobEmitInput,
  JobEventEmitter,
  OccurrenceRegistry,
  TaskProcessCoordinator,
  TriggerError,
} from "@/jobs/trigger-service"
import type {
  NotificationPublishInput,
  NotificationPublisher,
} from "@/jobs/notification-service"

const FIXED_MS = 1_721_260_800_000

// =============================================================================
// Schema fixtures (decode the wire form, so tests author no DateTime objects)
// =============================================================================

const decodeDefinition = Schema.decodeUnknownSync(Definition.JobDefinition)
const decodeRegistration = Schema.decodeUnknownSync(Reconciliation.ScheduleRegistration)

export interface DefinitionOver {
  readonly id?: string
  readonly scheduleId?: string
  readonly enabled?: boolean
  readonly overlap?: "allow" | "forbid" | "queue" | "replace"
  readonly misfire?: "skip" | "fire_once" | "bounded_catch_up" | "coalesce"
  readonly version?: number
  readonly secretRefs?: readonly string[]
  readonly payloadRef?: string | null
}

/** Build a valid durable `JobDefinition` by decoding its canonical wire form. */
export function makeJobDefinition(over: DefinitionOver = {}): Definition.JobDefinition {
  return decodeDefinition({
    id: over.id ?? "job_test_1",
    identity: {
      name: "nightly-reindex",
      description: "",
      owner: "op_1",
      version: over.version ?? 1,
      created_at: FIXED_MS,
      updated_at: FIXED_MS,
    },
    schedule: {
      schedule_id: over.scheduleId ?? "sch_1",
      schedule: { expression: "*/5 * * * *", timezone: "UTC" },
      minimum_interval_ms: 0,
      enabled: over.enabled ?? true,
    },
    policy: {
      misfire: over.misfire ?? "skip",
      overlap: over.overlap ?? "forbid",
      capability_surface: "in_process",
    },
    execution: {
      action_type: "native_maintenance",
      target: "maint.reindex",
      deadline_ms: 0,
      timeout_ms: 0,
      retry_budget: 0,
      priority: 0,
    },
    authorization: {
      scope: "project",
      project_ref: "proj_1",
      root_session_id: null,
      principal: "op_1",
      permissions: [],
      secret_refs: over.secretRefs ?? ["secretref_keychain_1"],
      payload_ref: over.payloadRef === undefined ? null : over.payloadRef,
    },
  })
}

/** Build a valid durable `ScheduleRegistration` by decoding its wire form. */
export function makeScheduleRegistration(over: {
  readonly id?: string
  readonly scheduleId?: string
  readonly state?: "pending" | "registered" | "unregistered" | "unknown" | "reconciled"
  readonly intent?: "register" | "unregister"
} = {}): Reconciliation.ScheduleRegistration {
  return decodeRegistration({
    job_definition_id: over.id ?? "job_test_1",
    schedule_id: over.scheduleId ?? "sch_1",
    state: over.state ?? "pending",
    intent: over.intent ?? "register",
    capability_surface: "in_process",
    updated_at: FIXED_MS,
  })
}

// =============================================================================
// Trigger-service seams
// =============================================================================

/** A `JobEventEmitter` that assigns monotonic `evt_` ids and records every emit. */
export function fakeEmitter(): { emitter: JobEventEmitter; emitted: JobEmitInput[] } {
  const emitted: JobEmitInput[] = []
  let n = 0
  const emitter: JobEventEmitter = {
    emit: (input) =>
      Effect.sync(() => {
        emitted.push(input)
        return { eventId: `evt_job_${n++}` }
      }),
  }
  return { emitter, emitted }
}

/** An in-memory `OccurrenceRegistry` keyed on the idempotency tuple. */
export function fakeRegistry(): { registry: OccurrenceRegistry; store: Map<string, Occurrence> } {
  const store = new Map<string, Occurrence>()
  const registry: OccurrenceRegistry = {
    findByTuple: (tupleKey) => Effect.sync(() => store.get(tupleKey)?.occurrenceId ?? null),
    record: (tupleKey, occurrence) => Effect.sync(() => void store.set(tupleKey, occurrence)),
  }
  return { registry, store }
}

export interface CoordinatorOptions {
  /** Admission decision; defaults to admitted. */
  readonly admission?: AdmissionOutcome
  /** Make `createProcess` fail with the given error (fault injection). */
  readonly createProcessError?: TriggerError
  readonly attempt?: number
}

export interface CoordinatorCalls {
  readonly admitted: string[]
  readonly created: string[]
  readonly todos: string[]
  readonly outputs: string[]
}

/** A canonical Feature 002 executor + Feature 005 output seam fake. */
export function fakeCoordinator(
  options: CoordinatorOptions = {},
): { coordinator: TaskProcessCoordinator; calls: CoordinatorCalls } {
  const calls: CoordinatorCalls = { admitted: [], created: [], todos: [], outputs: [] }
  const admission = options.admission ?? { admitted: true }
  const coordinator: TaskProcessCoordinator = {
    admit: (input) =>
      Effect.sync(() => {
        calls.admitted.push(input.occurrenceId)
        return admission
      }),
    createProcess: (input) =>
      options.createProcessError !== undefined
        ? Effect.fail(options.createProcessError)
        : Effect.sync((): AssociatedProcess => {
            calls.created.push(input.occurrenceId)
            return {
              processId: `proc_${input.occurrenceId}`,
              sessionId: `ses_${input.occurrenceId}`,
              attempt: options.attempt ?? 1,
            }
          }),
    provisionTodo: (input) =>
      Effect.sync(() => {
        calls.todos.push(input.occurrenceId)
        return { todoRef: `todo_${input.occurrenceId}` }
      }),
    provisionOutputGroup: (input) =>
      Effect.sync(() => {
        calls.outputs.push(input.occurrenceId)
        return { outputRef: `out_${input.occurrenceId}` }
      }),
  }
  return { coordinator, calls }
}

/** Enforceable in-process overlap capabilities (`forbid`+`allow` only, matching the adapter default). */
export const IN_PROCESS_OVERLAP: Overlap.OverlapCapabilities = { allow: true, queue: false, replace: false }

/** Overlap capabilities that additionally enforce `replace`/`queue` (an occurrence-layer surface). */
export const FULL_OVERLAP: Overlap.OverlapCapabilities = { allow: true, queue: true, replace: true }

// =============================================================================
// Notification-service seams
// =============================================================================

/** A `NotificationPublisher` that assigns monotonic `evt_` ids and records every publish. */
export function fakePublisher(): { publisher: NotificationPublisher; published: NotificationPublishInput[] } {
  const published: NotificationPublishInput[] = []
  let n = 0
  const publisher: NotificationPublisher = {
    publish: (input) =>
      Effect.sync(() => {
        published.push(input)
        return { eventId: `evt_ntf_${n++}` }
      }),
  }
  return { publisher, published }
}

// =============================================================================
// Operator `jobs.*` command-port seams
// =============================================================================

/** Build a redacted `JobDefinitionSummary` for the operator-port backend fake. */
export function makeSummary(over: Partial<JobDefinitionSummary> = {}): JobDefinitionSummary {
  return {
    jobDefinitionId: "job_test_1",
    name: "nightly-reindex",
    description: "",
    enabled: true,
    schedule: { scheduleId: "sch_1", cronExpression: "*/5 * * * *", ianaTimezone: "UTC" },
    actionType: "native_maintenance",
    overlapPolicy: "forbid",
    misfirePolicy: "skip",
    registrationState: "registered",
    nextDueAt: null,
    lastOutcome: null,
    version: 1,
    updatedAt: new Date(FIXED_MS).toISOString(),
    ...over,
  }
}

/** Build a redacted `Occurrence` for the operator-port backend fake. */
export function makeOccurrence(over: Partial<Occurrence> = {}): Occurrence {
  return {
    occurrenceId: "occ_1",
    jobDefinitionId: "job_test_1",
    scheduleId: "sch_1",
    nominalDueTime: "2026-07-18T00:00:00.000Z",
    generation: 0,
    correlationId: "corr_1",
    causationId: null,
    sessionId: null,
    rootSessionId: null,
    processId: null,
    attempt: null,
    state: "due",
    outcome: null,
    ...over,
  }
}

/** Build a `NotificationEnvelope` for the operator-port history fake. */
export function makeEnvelope(over: Partial<NotificationEnvelope> = {}): NotificationEnvelope {
  return {
    notificationId: "ntf_1",
    eventId: "evt_ntf_0",
    occurrenceId: "occ_1",
    jobDefinitionId: "job_test_1",
    targetRootSessionId: "ses_root",
    targetSessionId: null,
    source: "scheduler",
    type: "occurrence_completed",
    priority: "normal",
    createdAt: new Date(FIXED_MS).toISOString(),
    expiresAt: new Date(FIXED_MS + 60_000).toISOString(),
    correlationId: "occ_1",
    causationId: null,
    summary: "reindex complete",
    outputRef: null,
    deliveryState: "pending",
    ackState: "unacknowledged",
    ...over,
  }
}
