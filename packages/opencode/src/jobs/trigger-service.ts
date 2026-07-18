/**
 * Feature 003 / T023 (S11) — the trigger service.
 *
 * Turns one in-process `Bun.cron` due observation into a canonical Feature 002
 * Task Process, publishing the `job.*` occurrence lifecycle through the single
 * EventV2 authority (FR8, FR8a, FR9, FR13, FR14, C11, C14, C15, C16). It adds NO
 * second executor, runtime, event bus, or lifecycle: the occurrence executes as a
 * Feature 002 Task Process created at the existing session seams
 * (TaskTool/BackgroundJob/SessionExecution/SessionRunCoordinator/SessionRunner);
 * the Process Table only OBSERVES it, recording `owner_kind` scheduled-job (C16).
 *
 * The flow, driven by the framework-free domain engine (`@opencode-ai/core/jobs`)
 * and honest injected seams:
 *   1. Compute the idempotency tuple `(jobDefinitionId, scheduleId,
 *      nominalDueTime, generation)`; a duplicate delivery for the same tuple
 *      resolves to a single execution with an observable `duplicateOf` outcome
 *      (`OccurrenceStateMachine.resolveDuplicate`, FR10, AC6) — never a second
 *      admitted path.
 *   2. Publish `job.trigger_due`, create the occurrence, and claim it.
 *   3. Evaluate the overlap policy (`Overlap.evaluateOverlap`); a capability gap
 *      fails before any effect (FR5, AC22), `forbid` rejects, `replace` is
 *      mutation-safe, and a mid-mutation sibling is never killed (C3, AC5, AC25).
 *   4. Pass Feature 002 admission and the Feature 001 routing hard gates.
 *   5. Create/associate the Feature 002 Task Process, provision the
 *      occurrence-owned Feature 002 Todo and the Feature 005 OutputGroup BEFORE
 *      goal-bearing work (C14, C15), and publish the durable `job.triggered` /
 *      `job.admitted` checkpoints.
 *
 * `sequence`, `attempt`, and `generation` are executor-owned and only CARRIED
 * here, never authored (C6); an ambiguous mutating effect is never blindly
 * retried (FR14, C11). Every effect boundary is an injected seam so the service
 * is unit-testable in-process and the composition root wires the canonical
 * executor, admission gate, and `publishJobEvent` boundary exactly once
 * (documented wiring points).
 */
export * as TriggerService from "./trigger-service"

import { Effect } from "effect"
import { OccurrenceStateMachine } from "@opencode-ai/core/jobs/occurrence-state-machine"
import { Overlap } from "@opencode-ai/core/jobs/overlap"
import { SchedulerEngine } from "@opencode-ai/core/jobs/scheduler-engine"
import type {
  Attempt,
  Generation,
  JobDefinitionId,
  JobEventType,
  Occurrence,
  OccurrenceId,
  OccurrenceState,
  OverlapPolicy,
  ProcessId,
  RootSessionId,
  ScheduleId,
  SessionId,
} from "@opencode-ai/protocol/jobs/commands"

// =============================================================================
// Injected seams (documented wiring points, C16)
// =============================================================================

/** Typed failures the trigger service surfaces; never a fabricated occurrence state. */
export type TriggerError =
  | { readonly type: "capability_unsupported"; readonly capability: string }
  | { readonly type: "admission_rejected"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

/**
 * The bounded occurrence-identity envelope the composition root expands into the
 * schema `JobEnvelope` before calling `EventV2Bridge.publishJobEvent` (C8). Kept
 * as a seam so the trigger service authors no wire shape and no second channel.
 * `processId`/`sessionId`/`attempt` are null until the Task Process associates
 * (C16); `attempt` is executor-owned and never authored here (C6).
 */
export interface JobEmitEnvelope {
  readonly jobDefinitionId: JobDefinitionId
  readonly scheduleId: ScheduleId
  readonly occurrenceId: OccurrenceId
  readonly processId: ProcessId | null
  readonly rootSessionId: RootSessionId
  readonly sessionId: SessionId | null
  readonly attempt: Attempt | null
  readonly generation: Generation
  readonly correlationId: string
  readonly causationId: string | null
}

export interface JobEmitInput {
  readonly envelope: JobEmitEnvelope
  readonly eventType: JobEventType
  /** Bounded, redacted detail; never prompts, results, payloads, paths, or secrets (FR32). */
  readonly detail: Record<string, unknown>
}

/** Publishes one `job.*` occurrence event through the single EventV2 authority (C8). */
export interface JobEventEmitter {
  readonly emit: (input: JobEmitInput) => Effect.Effect<{ readonly eventId: string }, TriggerError>
}

/** Idempotency-tuple lookup and occurrence recording; the durable store lives behind it. */
export interface OccurrenceRegistry {
  /** The occurrence id already claimed for this idempotency tuple, or `null` if first. */
  readonly findByTuple: (tupleKey: string) => Effect.Effect<string | null, TriggerError>
  /** Record the resolved occurrence under its tuple (idempotent). */
  readonly record: (tupleKey: string, occurrence: Occurrence) => Effect.Effect<void, TriggerError>
}

/** A Feature 002 Task Process associated with an admitted occurrence (executor-owned identity). */
export interface AssociatedProcess {
  readonly processId: ProcessId
  readonly sessionId: SessionId
  /** Executor-owned attempt counter; carried onto the occurrence, never authored (C6). */
  readonly attempt: Attempt
}

/**
 * The canonical Feature 002 executor + Feature 005 output seams. The composition
 * root wires each method to the real `TaskTool`/`SessionExecution`/
 * `SessionRunCoordinator` (process), the Feature 002 session-owned Todo model,
 * and the Feature 005 OutputGroup — never a second executor or lifecycle (C16).
 */
export interface TaskProcessCoordinator {
  /** Feature 002 admission + Feature 001 routing hard gates; a denial is honest, never bypassed (FR27, C11). */
  readonly admit: (input: AdmissionInput) => Effect.Effect<AdmissionOutcome, TriggerError>
  /** Create/associate the canonical Feature 002 Task Process (Process Table records `owner_kind`). */
  readonly createProcess: (input: CreateProcessInput) => Effect.Effect<AssociatedProcess, TriggerError>
  /** Provision the occurrence-owned Feature 002 Todo before goal-bearing work (FR8, C14). */
  readonly provisionTodo: (input: ProvisionInput) => Effect.Effect<{ readonly todoRef: string }, TriggerError>
  /** Provision the occurrence-owned Feature 005 OutputGroup before goal-bearing work (FR8a, C15). */
  readonly provisionOutputGroup: (input: ProvisionInput) => Effect.Effect<{ readonly outputRef: string }, TriggerError>
}

export interface AdmissionInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly occurrenceId: OccurrenceId
  readonly rootSessionId: RootSessionId
}

/** The admission decision; a rejection is reported honestly, never turned into a fake `admitted`. */
export type AdmissionOutcome =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: string }

export interface CreateProcessInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly occurrenceId: OccurrenceId
  readonly rootSessionId: RootSessionId
  /** Fixed provenance recorded on the Process Table row for scheduled occurrences (C16). */
  readonly ownerKind: "scheduled-job"
}

export interface ProvisionInput {
  readonly occurrenceId: OccurrenceId
  readonly sessionId: SessionId
}

// =============================================================================
// Public request/response
// =============================================================================

export interface TriggerInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly scheduleId: ScheduleId
  /** Canonical nominal-due string key; the idempotency-tuple component (FR19, C6). */
  readonly nominalDueTime: string
  /** Executor-owned generation carried in the tuple; never authored here (C6). */
  readonly generation: Generation
  readonly rootSessionId: RootSessionId
  readonly correlationId: string
  readonly causationId: string | null
  /** Nominal due instant (epoch ms) — the lag baseline (FR19, AC4). */
  readonly nominalDueMs: number
  /** Observed trigger instant (epoch ms) from the in-process callback. */
  readonly observedAtMs: number
  readonly overlapPolicy: OverlapPolicy
  readonly overlapCapabilities: Overlap.OverlapCapabilities
  /** True when a sibling occurrence for this schedule is already active (C3). */
  readonly running: boolean
  /** True when the active sibling handler is mid-mutation; guards mutation-safe replace (C17). */
  readonly runningIsMutating: boolean
}

export interface TriggerOutput {
  readonly occurrence: Occurrence
  readonly outcome: OccurrenceState
  /** The primary occurrence id when this delivery was a duplicate, else `null` (AC6). */
  readonly duplicateOf: string | null
}

export interface TriggerServiceDeps {
  readonly emitter: JobEventEmitter
  readonly registry: OccurrenceRegistry
  readonly coordinator: TaskProcessCoordinator
  /** Occurrence id generator (default a Crockford-base32 `occ_` id). */
  readonly newOccurrenceId?: () => string
}

export interface TriggerService {
  readonly trigger: (input: TriggerInput) => Effect.Effect<TriggerOutput, TriggerError>
}

// =============================================================================
// Factory
// =============================================================================

/** Encode the canonical idempotency tuple as a stable composite registry key (FR10, C6). */
function tupleKey(input: TriggerInput): string {
  return [input.jobDefinitionId, input.scheduleId, input.nominalDueTime, input.generation].join(" ")
}

export function createTriggerService(deps: TriggerServiceDeps): TriggerService {
  const newOccurrenceId = deps.newOccurrenceId ?? defaultOccurrenceId

  const buildOccurrence = (
    input: TriggerInput,
    occurrenceId: string,
    state: OccurrenceState,
    over: Partial<Occurrence>,
  ): Occurrence => ({
    occurrenceId,
    jobDefinitionId: input.jobDefinitionId,
    scheduleId: input.scheduleId,
    nominalDueTime: input.nominalDueTime,
    generation: input.generation,
    correlationId: input.correlationId,
    causationId: input.causationId,
    sessionId: null,
    rootSessionId: input.rootSessionId,
    processId: null,
    attempt: null,
    state,
    outcome: null,
    ...over,
  })

  const emit = (
    input: TriggerInput,
    occurrenceId: string,
    associated: AssociatedProcess | null,
    eventType: JobEventType,
    detail: Record<string, unknown>,
  ): Effect.Effect<{ readonly eventId: string }, TriggerError> =>
    deps.emitter.emit({
      envelope: {
        jobDefinitionId: input.jobDefinitionId,
        scheduleId: input.scheduleId,
        occurrenceId: occurrenceId as OccurrenceId,
        processId: associated?.processId ?? null,
        rootSessionId: input.rootSessionId,
        sessionId: associated?.sessionId ?? null,
        attempt: associated?.attempt ?? null,
        generation: input.generation,
        correlationId: input.correlationId,
        causationId: input.causationId,
      },
      eventType,
      detail,
    })

  // Resolve the overlap policy for the claimed occurrence into a terminal branch,
  // a queued deferral, or admission; a capability gap fails before any effect.
  const resolveOverlap = (
    input: TriggerInput,
    occurrenceId: string,
  ): Effect.Effect<Occurrence | null, TriggerError> =>
    Effect.gen(function* () {
      const decision = Overlap.evaluateOverlap({
        policy: input.overlapPolicy,
        running: input.running,
        runningIsMutating: input.runningIsMutating,
        capabilities: input.overlapCapabilities,
      })
      if (decision.kind === "capability_gap") {
        return yield* Effect.fail<TriggerError>({ type: "capability_unsupported", capability: decision.capability })
      }
      if (decision.kind === "reject") {
        yield* emit(input, occurrenceId, null, "job.overlap_rejected", { policy: input.overlapPolicy })
        return buildOccurrence(input, occurrenceId, "overlap_rejected", { outcome: "overlap_rejected" })
      }
      if (decision.kind === "queue") {
        yield* emit(input, occurrenceId, null, "job.queued", { policy: input.overlapPolicy })
        return buildOccurrence(input, occurrenceId, "claimed", {})
      }
      if (decision.kind === "replace") {
        yield* emit(input, occurrenceId, null, "job.overlap_replaced", { policy: input.overlapPolicy })
      }
      return null // admit (or overlap_replaced → admitted): continue to the process seam
    })

  // Associate the Feature 002 Task Process and provision occurrence-owned work
  // state before goal-bearing work, then publish the durable checkpoints.
  const associateProcess = (
    input: TriggerInput,
    occurrenceId: string,
  ): Effect.Effect<Occurrence, TriggerError> =>
    Effect.gen(function* () {
      const admission = yield* deps.coordinator.admit({
        jobDefinitionId: input.jobDefinitionId,
        occurrenceId: occurrenceId as OccurrenceId,
        rootSessionId: input.rootSessionId,
      })
      if (!admission.admitted) {
        // Honest: a rejected admission stays `claimed` — never a fabricated `admitted` (C11).
        return buildOccurrence(input, occurrenceId, "claimed", { outcome: null })
      }

      const process = yield* deps.coordinator.createProcess({
        jobDefinitionId: input.jobDefinitionId,
        occurrenceId: occurrenceId as OccurrenceId,
        rootSessionId: input.rootSessionId,
        ownerKind: "scheduled-job",
      })
      const provision = { occurrenceId: occurrenceId as OccurrenceId, sessionId: process.sessionId }
      yield* deps.coordinator.provisionTodo(provision)
      yield* deps.coordinator.provisionOutputGroup(provision)

      yield* emit(input, occurrenceId, process, "job.admitted", {})
      yield* emit(input, occurrenceId, process, "job.triggered", {})
      return buildOccurrence(input, occurrenceId, "admitted", {
        processId: process.processId,
        sessionId: process.sessionId,
        attempt: process.attempt,
      })
    })

  const trigger = (input: TriggerInput): Effect.Effect<TriggerOutput, TriggerError> =>
    Effect.gen(function* () {
      const key = tupleKey(input)
      const existing = yield* deps.registry.findByTuple(key)
      const occurrenceId = newOccurrenceId()

      const duplicate = OccurrenceStateMachine.resolveDuplicate({
        incomingOccurrenceId: occurrenceId,
        existingOccurrenceId: existing,
      })
      if (duplicate.kind === "duplicate") {
        yield* emit(input, occurrenceId, null, "job.coalesced", { duplicate_of: duplicate.duplicate_of })
        const occurrence = buildOccurrence(input, occurrenceId, "coalesced", {
          outcome: "coalesced",
        })
        yield* deps.registry.record(key, occurrence)
        return { occurrence, outcome: "coalesced", duplicateOf: duplicate.duplicate_of }
      }

      const lagMs = SchedulerEngine.measureScheduleLagMs(input.nominalDueMs, input.observedAtMs)
      yield* emit(input, occurrenceId, null, "job.trigger_due", { schedule_lag_ms: lagMs })
      yield* emit(input, occurrenceId, null, "job.occurrence_claimed", {})

      const branched = yield* resolveOverlap(input, occurrenceId)
      const occurrence = branched ?? (yield* associateProcess(input, occurrenceId))
      yield* deps.registry.record(key, occurrence)
      return { occurrence, outcome: occurrence.state, duplicateOf: null }
    })

  return { trigger }
}

// Crockford-base32 `occ_` id for the injected default; the composition root may
// pass a monotonic generator so occurrence ids sort by creation order.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
function defaultOccurrenceId(): string {
  let rand = ""
  for (let i = 0; i < 20; i++) rand += CROCKFORD[Math.floor(Math.random() * 32)]
  return `occ_${rand}`
}
