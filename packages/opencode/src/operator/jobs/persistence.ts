/**
 * Feature 014 / T010 (FR9) — the operator-side `jobs` persistence seam over the
 * reused Feature 007 `ConfigPort`, made round-trip capable by the Group A config
 * alignment (FR1–FR4).
 *
 * The Feature 003 flat operator command surface carries only the fields an
 * operator supplies (`name`/`schedule`/`actionType`/`overlap`/`misfire`/`scope`/
 * `payloadRef`) — it deliberately does NOT carry the durable `Definition.JobDefinition`
 * internals (`target`, `capability_surface`, deadline/timeout budgets, permission
 * set). Assembling a full durable definition here would have to INVENT those
 * fields, which the honesty invariant forbids (FR14). So this seam persists a
 * bounded, secret-free **operator job record** — exactly the operator-provided
 * fields plus a generated id, a monotonic domain `version`, and timestamps —
 * projected 1:1 onto the redacted `JobDefinitionSummary` the reads return. The
 * full durable-definition assembly and the external scheduler registration remain
 * the Feature 003 residual the executor/lifecycle edges (T011) own.
 *
 * Single-authority CAS discipline (the shared Feature 014 `mutation_plan` contract,
 * `../application/handler.ts`): all operator job records live in ONE config
 * authority (`jobs`) as a keyed map, so every mutating verb is a pure transform of
 * that one authority's payload and `mutateAuthority` owns the single committed CAS
 * write — the backend never self-commits (FR5). Validation (enum/schema decode +
 * the never-plaintext scan, FR11) runs at PLAN time BEFORE any plan is produced, so
 * a rejected mutation persists nothing (no phantom write). A Config.Service outage
 * degrades every read and every plan-time load to a typed `unavailable` — never a
 * fabricated success (FR14).
 */
export * as OperatorJobPersistence from "./persistence"

import { Effect, Schema } from "effect"
import { findPlaintextSecretFields } from "@opencode-ai/core/operator"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type { ConfigPort } from "@/operator/application/ports"
import type {
  ActionType,
  JobDefinitionSummary,
  JobsCreateInput,
  JobsDeleteInput,
  JobsDisableInput,
  JobsEnableInput,
  JobsError,
  JobsListInput,
  JobsListOutput,
  JobsRescheduleInput,
  JobsShowInput,
  JobsShowOutput,
  JobsStatusInput,
  JobsStatusOutput,
  JobsUpdateInput,
  MisfirePolicy,
  OverlapPolicy,
} from "@opencode-ai/protocol/jobs/commands"

// =============================================================================
// Bounded operator job record (round-trip codec, FR11 never-plaintext)
// =============================================================================

/** The single Config.Service authority holding every operator job record (FR2, FR9). */
export const AUTHORITY = "jobs" as const

const ACTION_TYPES = [
  "native_maintenance",
  "operator_notification",
  "wake_or_structured_input",
  "smart_routing_dispatch",
  "approved_workflow",
] as const
const OVERLAP_POLICIES = ["allow", "forbid", "queue", "replace"] as const
const MISFIRE_POLICIES = ["skip", "fire_once", "bounded_catch_up", "coalesce"] as const

/** The bounded, secret-free operator job record — only what the operator input carries. */
const OperatorJobRecord = Schema.Struct({
  jobDefinitionId: Schema.String,
  scheduleId: Schema.String,
  name: Schema.String,
  description: Schema.String,
  enabled: Schema.Boolean,
  cronExpression: Schema.String,
  ianaTimezone: Schema.String,
  actionType: Schema.Literals(ACTION_TYPES),
  overlapPolicy: Schema.Literals(OVERLAP_POLICIES),
  misfirePolicy: Schema.Literals(MISFIRE_POLICIES),
  scope: Schema.Literals(["project", "global"]),
  scopeId: Schema.String,
  payloadRef: Schema.String,
  version: Schema.Number,
  createdAtMs: Schema.Number,
  updatedAtMs: Schema.Number,
})
type OperatorJobRecord = typeof OperatorJobRecord.Type

/** The persisted authority document: a map of records keyed by job definition id. */
const OperatorJobDocument = Schema.Struct({
  definitions: Schema.Record(Schema.String, OperatorJobRecord),
})
type OperatorJobDocument = typeof OperatorJobDocument.Type

const decodeDocument = Schema.decodeUnknownSync(OperatorJobDocument)
const decodeRecord = Schema.decodeUnknownSync(OperatorJobRecord)

const EMPTY_DOCUMENT: OperatorJobDocument = { definitions: {} }

// =============================================================================
// Deps + factory surface
// =============================================================================

export interface OperatorJobPersistenceDeps {
  readonly config: ConfigPort
  /** Monotonic millisecond clock stamped onto each write (default `Date.now`). */
  readonly clock?: () => number
  /** Opaque id generator for a new definition/schedule (default crypto random). */
  readonly idGen?: (prefix: string) => string
}

/** The operator jobs persistence surface: redacted reads + validated mutation plans. */
export interface OperatorJobPersistence {
  readonly list: (input: JobsListInput) => Effect.Effect<JobsListOutput, JobsError>
  readonly status: (input: JobsStatusInput) => Effect.Effect<JobsStatusOutput, JobsError>
  readonly show: (input: JobsShowInput) => Effect.Effect<JobsShowOutput, JobsError>
  readonly planCreate: (input: JobsCreateInput) => Effect.Effect<OperatorMutationPlan, JobsError>
  readonly planUpdate: (input: JobsUpdateInput) => Effect.Effect<OperatorMutationPlan, JobsError>
  readonly planEnable: (input: JobsEnableInput) => Effect.Effect<OperatorMutationPlan, JobsError>
  readonly planDisable: (input: JobsDisableInput) => Effect.Effect<OperatorMutationPlan, JobsError>
  readonly planDelete: (input: JobsDeleteInput) => Effect.Effect<OperatorMutationPlan, JobsError>
  readonly planReschedule: (input: JobsRescheduleInput) => Effect.Effect<OperatorMutationPlan, JobsError>
}

const unavailable = (reason: string): JobsError => ({ type: "unavailable", reason })
const notFound = (jobDefinitionId: string): JobsError => ({ type: "not_found", jobDefinitionId })

// =============================================================================
// Pure projections + document transforms
// =============================================================================

/** Project a bounded record onto the redacted operator summary; not-yet-projected fields stay null. */
function toSummary(record: OperatorJobRecord): JobDefinitionSummary {
  return {
    jobDefinitionId: record.jobDefinitionId,
    name: record.name,
    description: record.description,
    enabled: record.enabled,
    schedule: { scheduleId: record.scheduleId, cronExpression: record.cronExpression, ianaTimezone: record.ianaTimezone },
    actionType: record.actionType as ActionType,
    overlapPolicy: record.overlapPolicy as OverlapPolicy,
    misfirePolicy: record.misfirePolicy as MisfirePolicy,
    // No external scheduler registration is reachable at this seam (T011); "unknown"
    // is the honest durable state and next-due / last-outcome stay unprojected.
    registrationState: "unknown",
    nextDueAt: null,
    lastOutcome: null,
    version: record.version,
    updatedAt: new Date(record.updatedAtMs).toISOString(),
  }
}

/** True when a record is in scope for a `jobs.list` filter (a global record is always visible). */
function inListScope(record: OperatorJobRecord, input: JobsListInput): boolean {
  if (input.scope === "global") return true
  if (record.scope === "global") return true
  return record.scopeId === input.scopeId
}

/** Coerce a raw persisted payload into a document without throwing (apply must stay pure). */
function asDocument(current: unknown): OperatorJobDocument {
  if (current === null || typeof current !== "object" || !("definitions" in current)) return EMPTY_DOCUMENT
  const definitions = (current as { definitions?: unknown }).definitions
  return definitions !== null && typeof definitions === "object" ? { definitions: definitions as OperatorJobDocument["definitions"] } : EMPTY_DOCUMENT
}

/** Pure transform: set a record into the authority document, preserving the rest. */
const setRecord = (record: OperatorJobRecord) => (current: unknown): OperatorJobDocument => {
  const document = asDocument(current)
  return { definitions: { ...document.definitions, [record.jobDefinitionId]: record } }
}

/** Pure transform: drop a record from the authority document, preserving the rest. */
const removeRecord = (jobDefinitionId: string) => (current: unknown): OperatorJobDocument => {
  const document = asDocument(current)
  const { [jobDefinitionId]: _dropped, ...rest } = document.definitions
  return { definitions: rest }
}

/** Merge only the present `jobs.update` patch fields onto a record and bump its version. */
function applyPatch(record: OperatorJobRecord, patch: JobsUpdateInput["patch"], nowMs: number): OperatorJobRecord {
  const schedule = patch.schedule
  return {
    ...record,
    name: patch.name ?? record.name,
    description: patch.description ?? record.description,
    cronExpression: schedule?.cronExpression ?? record.cronExpression,
    ianaTimezone: schedule?.ianaTimezone ?? record.ianaTimezone,
    actionType: (patch.actionType ?? record.actionType) as OperatorJobRecord["actionType"],
    overlapPolicy: (patch.overlapPolicy ?? record.overlapPolicy) as OperatorJobRecord["overlapPolicy"],
    misfirePolicy: (patch.misfirePolicy ?? record.misfirePolicy) as OperatorJobRecord["misfirePolicy"],
    scope: (patch.scope ?? record.scope) as OperatorJobRecord["scope"],
    scopeId: patch.scopeId ?? record.scopeId,
    payloadRef: patch.payloadRef ?? record.payloadRef,
    version: record.version + 1,
    updatedAtMs: nowMs,
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createOperatorJobPersistence(deps: OperatorJobPersistenceDeps): OperatorJobPersistence {
  const config = deps.config
  const clock = deps.clock ?? Date.now
  const idGen = deps.idGen ?? ((prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`)

  /** Load the authority document; an outage degrades to `unavailable`, a corrupt doc to `unavailable`. */
  const loadDocument = (): Effect.Effect<OperatorJobDocument, JobsError> =>
    Effect.gen(function* () {
      const entry = yield* Effect.tryPromise({ try: () => config.get(AUTHORITY), catch: (cause) => unavailable(String(cause)) })
      if (entry === null || entry.payload === null) return EMPTY_DOCUMENT
      return yield* Effect.try({ try: () => decodeDocument(entry.payload), catch: (cause) => unavailable(`corrupt jobs document: ${String(cause)}`) })
    })

  /** Validate a record at PLAN time: closed-enum schema decode + the never-plaintext scan (FR11, FR14). */
  const validate = (record: OperatorJobRecord): Effect.Effect<void, JobsError> =>
    Effect.gen(function* () {
      const leaks = findPlaintextSecretFields(record)
      if (leaks.length > 0) return yield* Effect.fail<JobsError>({ type: "invalid_argument", field: "payloadRef", reason: `plaintext secret: ${leaks.join(",")}` })
      yield* Effect.try({ try: () => decodeRecord(record), catch: (cause) => ({ type: "invalid_argument", field: "definition", reason: String(cause) }) as JobsError })
    })

  /** Build a validated plan that mutates the record at `id`, or a typed `not_found`. */
  const planForExisting = (id: string, transform: (record: OperatorJobRecord) => OperatorJobRecord): Effect.Effect<OperatorMutationPlan, JobsError> =>
    Effect.gen(function* () {
      const document = yield* loadDocument()
      const existing = document.definitions[id]
      if (existing === undefined) return yield* Effect.fail<JobsError>(notFound(id))
      const next = transform(existing)
      yield* validate(next)
      return { authority: AUTHORITY, apply: setRecord(next) }
    })

  const list = (input: JobsListInput): Effect.Effect<JobsListOutput, JobsError> =>
    Effect.gen(function* () {
      const document = yield* loadDocument()
      const summaries: JobDefinitionSummary[] = []
      for (const record of Object.values(document.definitions)) {
        if (!inListScope(record, input)) continue
        if (input.enabledOnly === true && record.enabled !== true) continue
        summaries.push(toSummary(record))
        if (summaries.length >= input.limit) break
      }
      return { definitions: summaries, cursor: null }
    })

  const status = (input: JobsStatusInput): Effect.Effect<JobsStatusOutput, JobsError> =>
    Effect.gen(function* () {
      const document = yield* loadDocument()
      const record = document.definitions[input.jobDefinitionId]
      if (record === undefined) return yield* Effect.fail<JobsError>(notFound(input.jobDefinitionId))
      return { definition: toSummary(record) }
    })

  const show = (input: JobsShowInput): Effect.Effect<JobsShowOutput, JobsError> =>
    Effect.gen(function* () {
      const { definition } = yield* status({ jobDefinitionId: input.jobDefinitionId })
      // The persisted definition reads over real state; occurrence history is an
      // EventV2 projection not wired at this seam, so the list stays honestly empty.
      return { definition, occurrences: [] }
    })

  const planCreate = (input: JobsCreateInput): Effect.Effect<OperatorMutationPlan, JobsError> =>
    Effect.gen(function* () {
      const nowMs = clock()
      const jobDefinitionId = idGen("job")
      const record: OperatorJobRecord = {
        jobDefinitionId,
        scheduleId: idGen("sch"),
        name: input.name,
        description: input.description,
        enabled: true,
        cronExpression: input.schedule.cronExpression,
        ianaTimezone: input.schedule.ianaTimezone,
        actionType: input.actionType as OperatorJobRecord["actionType"],
        overlapPolicy: input.overlapPolicy as OperatorJobRecord["overlapPolicy"],
        misfirePolicy: input.misfirePolicy as OperatorJobRecord["misfirePolicy"],
        scope: input.scope,
        scopeId: input.scopeId,
        payloadRef: input.payloadRef,
        version: 1,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      }
      yield* validate(record)
      return { authority: AUTHORITY, apply: setRecord(record) }
    })

  const planUpdate = (input: JobsUpdateInput): Effect.Effect<OperatorMutationPlan, JobsError> =>
    planForExisting(input.jobDefinitionId, (record) => applyPatch(record, input.patch, clock()))

  const setEnabled = (id: string, enabled: boolean): Effect.Effect<OperatorMutationPlan, JobsError> =>
    planForExisting(id, (record) => ({ ...record, enabled, version: record.version + 1, updatedAtMs: clock() }))

  const planEnable = (input: JobsEnableInput): Effect.Effect<OperatorMutationPlan, JobsError> => setEnabled(input.jobDefinitionId, true)
  const planDisable = (input: JobsDisableInput): Effect.Effect<OperatorMutationPlan, JobsError> => setEnabled(input.jobDefinitionId, false)

  const planReschedule = (input: JobsRescheduleInput): Effect.Effect<OperatorMutationPlan, JobsError> =>
    planForExisting(input.jobDefinitionId, (record) => ({
      ...record,
      cronExpression: input.schedule.cronExpression,
      ianaTimezone: input.schedule.ianaTimezone,
      version: record.version + 1,
      updatedAtMs: clock(),
    }))

  const planDelete = (input: JobsDeleteInput): Effect.Effect<OperatorMutationPlan, JobsError> =>
    Effect.gen(function* () {
      const document = yield* loadDocument()
      if (document.definitions[input.jobDefinitionId] === undefined) return yield* Effect.fail<JobsError>(notFound(input.jobDefinitionId))
      return { authority: AUTHORITY, apply: removeRecord(input.jobDefinitionId) }
    })

  return { list, status, show, planCreate, planUpdate, planEnable, planDisable, planDelete, planReschedule }
}
