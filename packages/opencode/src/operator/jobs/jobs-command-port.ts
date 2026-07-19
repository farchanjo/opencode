/**
 * Feature 003 / T027 (S15) — the `jobs.*` inbound command adapter, converted to the
 * Feature 014 `OperatorMutationPlan` commit contract (FR5).
 *
 * Bridges the reserved Feature 007 `jobs.*` operator command ids to the typed
 * `JobsBackend` seam through the Feature 007 dispatcher's `DomainInvoke` seam,
 * exactly like `telemetry-command-port.ts`. Feature 007 remains the SOLE
 * registration authority: this adapter registers NO command ids — it only
 * supplies the `jobs` domain `invoke`, replacing the `not_implemented` stub.
 * Reserved-id collisions (`job.*`/`jobs.*`) are rejected by the Feature 007
 * reserved-name guard, unchanged here (C13, FR30).
 *
 * Every command is parsed and dispatched LOCALLY (before any prompt admission):
 * the payload never reaches a model, and every port call is model-independent
 * and zero-cost (FR31, AC14). Reads project the bounded, redacted operator view;
 * mutations VALIDATE and return a `mutation_plan` so the Feature 007
 * `mutateAuthority` pipeline owns the single committed CAS write + audit
 * correlation — the backend never self-commits, and an unreachable seam honestly
 * degrades to a typed failure with no phantom write. This adapter is the single
 * uniform operator access-audit point — it holds the Feature 007 principal for
 * every command, including the principal-less read ports — and emits exactly one
 * bounded, secret-free audit event per dispatch (a successful mutation is audited by
 * the commit, not here).
 */
export * as JobsCommandPort from "./jobs-command-port"

import { Effect } from "effect"
import type { OperatorPrincipal as OperatorPrincipalCore } from "@opencode-ai/core/operator"
import type {
  ActionType,
  JobsError,
  JobsListInput,
  JobsUpdateInput,
  MisfirePolicy,
  OperatorPrincipal as JobsOperatorPrincipal,
  OverlapPolicy,
  Schedule,
} from "@opencode-ai/protocol/jobs/commands"
import type { HandlerContext, HandlerResult, FailureHandlerResult, OperatorMutationPlan } from "@/operator/application/handler"
import type { CommandRequest } from "@opencode-ai/core/operator"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { JobsAuditEvent, JobsAuditSink, JobsBackend } from "./jobs-port"

export interface JobsDomainPorts {
  readonly jobs: { readonly invoke: DomainInvoke }
}

export interface JobsCommandDeps {
  readonly backend: JobsBackend
  readonly audit: JobsAuditSink
}

type ScheduleInput = Omit<Schedule, "scheduleId">

// =============================================================================
// Payload helpers
// =============================================================================

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function firstString(record: Record<string, unknown>, keys: ReadonlyArray<string>): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function firstNumber(record: Record<string, unknown>, keys: ReadonlyArray<string>): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

function firstBoolean(record: Record<string, unknown>, keys: ReadonlyArray<string>): boolean | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "boolean") return value
  }
  return undefined
}

function fail(code: FailureHandlerResult["code"], message: string, details?: FailureHandlerResult["details"]): FailureHandlerResult {
  return { kind: "failure", code, message, details }
}

/** Map the Feature 007 operator principal onto the jobs operator principal (C12). */
function toJobsOperator(principal: OperatorPrincipalCore): JobsOperatorPrincipal {
  return { kind: principal.kind, id: principal.subject }
}

/** Parse a nested `{ cronExpression, ianaTimezone }` schedule, or the flat form. */
function parseSchedule(record: Record<string, unknown>): ScheduleInput | undefined {
  const nested = asRecord(record["schedule"])
  const source = firstString(nested, ["cronExpression", "cron_expression"]) !== undefined ? nested : record
  const cronExpression = firstString(source, ["cronExpression", "cron_expression"])
  const ianaTimezone = firstString(source, ["ianaTimezone", "iana_timezone", "timezone"])
  if (cronExpression === undefined || ianaTimezone === undefined) return undefined
  return { cronExpression, ianaTimezone }
}

/** Resolve the CAS `expectedVersion` from the payload or the envelope `version`. */
function resolveExpectedVersion(record: Record<string, unknown>, request: CommandRequest): number | undefined {
  const fromPayload = firstNumber(record, ["expectedVersion", "expected_version", "version"])
  if (fromPayload !== undefined) return fromPayload
  if (request.version !== undefined) {
    const parsed = Number(request.version)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** Build the bounded `jobs.update` patch from only the fields present in the payload. */
function buildUpdatePatch(record: Record<string, unknown>): JobsUpdateInput["patch"] {
  const source = record["patch"] !== undefined ? asRecord(record["patch"]) : record
  const patch: Record<string, unknown> = {}
  const name = firstString(source, ["name"])
  if (name !== undefined) patch["name"] = name
  const description = firstString(source, ["description"])
  if (description !== undefined) patch["description"] = description
  const schedule = parseSchedule(source)
  if (schedule !== undefined) patch["schedule"] = schedule
  const actionType = firstString(source, ["actionType", "action_type"])
  if (actionType !== undefined) patch["actionType"] = actionType as ActionType
  const overlapPolicy = firstString(source, ["overlapPolicy", "overlap_policy"])
  if (overlapPolicy !== undefined) patch["overlapPolicy"] = overlapPolicy as OverlapPolicy
  const misfirePolicy = firstString(source, ["misfirePolicy", "misfire_policy"])
  if (misfirePolicy !== undefined) patch["misfirePolicy"] = misfirePolicy as MisfirePolicy
  const scope = firstString(source, ["scope"])
  if (scope !== undefined) patch["scope"] = scope as JobsListInput["scope"]
  const scopeId = firstString(source, ["scopeId", "scope_id"])
  if (scopeId !== undefined) patch["scopeId"] = scopeId
  const payloadRef = firstString(source, ["payloadRef", "payload_ref"])
  if (payloadRef !== undefined) patch["payloadRef"] = payloadRef
  return patch as JobsUpdateInput["patch"]
}

// =============================================================================
// Error mapping
// =============================================================================

/** Map the closed `JobsError` union onto the bounded operator audit outcome. */
function auditOutcome(error: JobsError): JobsAuditEvent["outcome"] {
  switch (error.type) {
    case "not_found":
      return "not_found"
    case "unauthorized":
      return "unauthorized"
    case "version_conflict":
      return "conflict"
    default:
      return "rejected"
  }
}

/** Map the closed `JobsError` union onto an operator failure code + envelope. */
function jobsErrorToFailure(error: JobsError): FailureHandlerResult {
  switch (error.type) {
    case "not_found":
      return fail("invalid_argument", `job ${error.jobDefinitionId} not found`, {
        field: "jobDefinitionId",
        jobDefinitionId: error.jobDefinitionId,
      })
    case "unauthorized":
      return fail("unauthorized", error.reason)
    case "version_conflict":
      return fail("invalid_argument", `version conflict: expected ${error.expectedVersion}, actual ${error.actualVersion}`, {
        field: "expectedVersion",
        expectedVersion: error.expectedVersion,
        actualVersion: error.actualVersion,
      })
    case "invalid_argument":
      return fail("invalid_argument", error.reason, { field: error.field })
    case "reserved_name":
      return fail("invalid_argument", `reserved id ${error.id}`, { field: "id", id: error.id })
    case "capability_unsupported":
      return fail("unavailable", `capability unsupported: ${error.capability}`, { capability: error.capability })
    case "unavailable":
      return fail("unavailable", error.reason)
    case "not_implemented":
      return fail("not_implemented", "operation is not implemented")
  }
}

// =============================================================================
// jobs.* domain invoke
// =============================================================================

function jobsInvoke(deps: JobsCommandDeps): DomainInvoke {
  const { backend } = deps

  /** Run a read effect, emit exactly one audit event, and shape the result. */
  const run = <A>(
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<A, JobsError>,
    onSuccess: (value: A) => HandlerResult,
  ): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (value): Effect.Effect<HandlerResult> =>
            deps.audit.record({ commandId, principalId, target, outcome: "ok" }).pipe(Effect.as(onSuccess(value))),
          onFailure: (error): Effect.Effect<HandlerResult> =>
            deps.audit
              .record({ commandId, principalId, target, outcome: auditOutcome(error) })
              .pipe(Effect.as(jobsErrorToFailure(error))),
        }),
      ),
    )

  /**
   * Validate a mutation and hand back the `mutation_plan` the dispatcher commits via
   * `mutateAuthority` (which emits the Feature 007 audit correlation on success).
   * Only a rejection is audited here — a successful plan is audited by the commit,
   * so no write is ever persisted while the caller is told it failed.
   */
  const runPlan = (
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<OperatorMutationPlan, JobsError>,
  ): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (plan): Effect.Effect<HandlerResult> => Effect.succeed({ kind: "mutation_plan", ...plan }),
          onFailure: (error): Effect.Effect<HandlerResult> =>
            deps.audit
              .record({ commandId, principalId, target, outcome: auditOutcome(error) })
              .pipe(Effect.as(jobsErrorToFailure(error))),
        }),
      ),
    )

  const query = (value: unknown): HandlerResult => ({ kind: "query", effective: value })

  return (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    const payload = asRecord(ctx.request.payload)
    const principal = toJobsOperator(ctx.request.principal)
    const principalId = principal.id
    const jobDefinitionId = firstString(payload, ["jobDefinitionId", "job_definition_id", "id"])
    const requireId = (): FailureHandlerResult =>
      fail("invalid_argument", `${id} requires a jobDefinitionId`, { field: "jobDefinitionId" })
    const requireVersion = (): FailureHandlerResult =>
      fail("invalid_argument", `${id} requires an expectedVersion`, { field: "expectedVersion" })
    /**
     * Resolve the CAS guard for a mutating verb. The single committed config CAS is
     * driven by the envelope `version` (the opaque `cas_vN` token `mutateAuthority`
     * enforces), so a string token satisfies the requirement even though the numeric
     * domain `expectedVersion` is `NaN`; only a total absence of both is rejected. The
     * numeric value is passed through as domain metadata (0 when only the token is set).
     */
    const resolveCasVersion = (): FailureHandlerResult | { readonly expectedVersion: number } => {
      const numeric = resolveExpectedVersion(payload, ctx.request)
      if (numeric === undefined && ctx.request.version === undefined) return requireVersion()
      return { expectedVersion: numeric ?? 0 }
    }

    switch (id) {
      case "jobs.list": {
        const scope = (firstString(payload, ["scope"]) ?? ctx.request.scope.kind) as JobsListInput["scope"]
        const scopeId = firstString(payload, ["scopeId", "scope_id"]) ?? ctx.request.scope.ref ?? ""
        const input: JobsListInput = {
          scope,
          scopeId,
          limit: firstNumber(payload, ["limit"]) ?? 50,
          enabledOnly: firstBoolean(payload, ["enabledOnly", "enabled_only"]),
          cursor: firstString(payload, ["cursor"]),
        }
        return run("jobs.list", principalId, scopeId, backend.list(input), query)
      }

      case "jobs.status": {
        if (jobDefinitionId === undefined) return Promise.resolve(requireId())
        return run("jobs.status", principalId, jobDefinitionId, backend.status({ jobDefinitionId }), query)
      }

      case "jobs.show": {
        if (jobDefinitionId === undefined) return Promise.resolve(requireId())
        const occurrenceLimit = firstNumber(payload, ["occurrenceLimit", "occurrence_limit"]) ?? 20
        return run("jobs.show", principalId, jobDefinitionId, backend.show({ jobDefinitionId, occurrenceLimit }), query)
      }

      case "jobs.history": {
        if (jobDefinitionId === undefined) return Promise.resolve(requireId())
        const input = {
          jobDefinitionId,
          limit: firstNumber(payload, ["limit"]) ?? 50,
          cursor: firstString(payload, ["cursor"]),
        }
        return run("jobs.history", principalId, jobDefinitionId, backend.history(input), query)
      }

      case "jobs.watch": {
        if (jobDefinitionId === undefined) return Promise.resolve(requireId())
        // Request/response surface: return the bounded current definition frame;
        // the CLI/TUI attach the live `job.*` stream over the observation seam
        // (T030). This keeps watch honest and zero-model.
        return run("jobs.watch", principalId, jobDefinitionId, backend.status({ jobDefinitionId }), (out) =>
          query({ definition: out.definition, streaming: "observation-surface" }),
        )
      }

      case "jobs.create": {
        const name = firstString(payload, ["name"])
        const schedule = parseSchedule(payload)
        const actionType = firstString(payload, ["actionType", "action_type"]) as ActionType | undefined
        const payloadRef = firstString(payload, ["payloadRef", "payload_ref"])
        if (name === undefined) return Promise.resolve(fail("invalid_argument", "jobs.create requires a name", { field: "name" }))
        if (schedule === undefined)
          return Promise.resolve(fail("invalid_argument", "jobs.create requires a cronExpression and ianaTimezone", { field: "schedule" }))
        if (actionType === undefined) return Promise.resolve(fail("invalid_argument", "jobs.create requires an actionType", { field: "actionType" }))
        if (payloadRef === undefined) return Promise.resolve(fail("invalid_argument", "jobs.create requires a payloadRef", { field: "payloadRef" }))
        const scope = (firstString(payload, ["scope"]) ?? ctx.request.scope.kind) as JobsListInput["scope"]
        const scopeId = firstString(payload, ["scopeId", "scope_id"]) ?? ctx.request.scope.ref ?? ""
        const input = {
          name,
          description: firstString(payload, ["description"]) ?? "",
          schedule,
          actionType,
          overlapPolicy: (firstString(payload, ["overlapPolicy", "overlap_policy"]) ?? "forbid") as OverlapPolicy,
          misfirePolicy: (firstString(payload, ["misfirePolicy", "misfire_policy"]) ?? "skip") as MisfirePolicy,
          scope,
          scopeId,
          payloadRef,
          principal,
        }
        return runPlan("jobs.create", principalId, name, backend.planCreate(input))
      }

      case "jobs.update": {
        if (jobDefinitionId === undefined) return Promise.resolve(requireId())
        const cas = resolveCasVersion()
        if ("kind" in cas) return Promise.resolve(cas)
        const input: JobsUpdateInput = {
          jobDefinitionId,
          expectedVersion: cas.expectedVersion,
          patch: buildUpdatePatch(payload),
          principal,
        }
        return runPlan("jobs.update", principalId, jobDefinitionId, backend.planUpdate(input))
      }

      case "jobs.enable": {
        if (jobDefinitionId === undefined) return Promise.resolve(requireId())
        const cas = resolveCasVersion()
        if ("kind" in cas) return Promise.resolve(cas)
        return runPlan("jobs.enable", principalId, jobDefinitionId, backend.planEnable({ jobDefinitionId, expectedVersion: cas.expectedVersion, principal }))
      }

      case "jobs.disable": {
        if (jobDefinitionId === undefined) return Promise.resolve(requireId())
        const cas = resolveCasVersion()
        if ("kind" in cas) return Promise.resolve(cas)
        return runPlan("jobs.disable", principalId, jobDefinitionId, backend.planDisable({ jobDefinitionId, expectedVersion: cas.expectedVersion, principal }))
      }

      case "jobs.delete": {
        if (jobDefinitionId === undefined) return Promise.resolve(requireId())
        const cas = resolveCasVersion()
        if ("kind" in cas) return Promise.resolve(cas)
        return runPlan("jobs.delete", principalId, jobDefinitionId, backend.planDelete({ jobDefinitionId, expectedVersion: cas.expectedVersion, principal }))
      }

      case "jobs.reschedule": {
        if (jobDefinitionId === undefined) return Promise.resolve(requireId())
        const cas = resolveCasVersion()
        if ("kind" in cas) return Promise.resolve(cas)
        const schedule = parseSchedule(payload)
        if (schedule === undefined)
          return Promise.resolve(fail("invalid_argument", "jobs.reschedule requires a cronExpression and ianaTimezone", { field: "schedule" }))
        return runPlan(
          "jobs.reschedule",
          principalId,
          jobDefinitionId,
          backend.planReschedule({ jobDefinitionId, expectedVersion: cas.expectedVersion, schedule, principal }),
        )
      }

      case "jobs.run-now": {
        if (jobDefinitionId === undefined) return Promise.resolve(requireId())
        return runPlan("jobs.run-now", principalId, jobDefinitionId, backend.planRunNow({ jobDefinitionId, principal }))
      }

      default:
        return Promise.resolve(fail("not_implemented", `jobs command ${id} is not implemented`))
    }
  }
}

/**
 * Build the `jobs` DomainPort override. Wire it into the Feature 007 dispatcher
 * via `wireDomainPorts(createJobsDomainPorts({ backend, audit }))` at the composition
 * root — it replaces the `not_implemented` stub without touching the registry.
 */
export function createJobsDomainPorts(deps: JobsCommandDeps): JobsDomainPorts {
  return {
    jobs: { invoke: jobsInvoke(deps) },
  }
}
