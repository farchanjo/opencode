/**
 * Feature 018 / Group C (T011) — the persistence bridge that rehydrates the eager
 * executor composition from the operator-side `jobs` persistence.
 *
 * Group A left the live `reconcileSource` / `resolveDueContext` honest-empty: the
 * cron loop armed, but no enabled definition re-registered on the startup sweep and
 * a due signal resolved to `null`. This module closes that gap by projecting the
 * SAME redacted operator job records the operator surface persists
 * (`operator/jobs/persistence.ts`, config authority `jobs`) into the bounded
 * `RegistrationView` / `DueRegistrationView` the composition consumes — reusing the
 * committed operator persistence rather than a second store (FR1, FR8).
 *
 * The definition-keyed durable aggregate (Group C, T010) is realised here: a
 * scheduled occurrence has no external parent session, so its `rootSessionId` is
 * the job definition itself (`= jobDefinitionId`). The `EventV2Bridge` derives the
 * durable aggregate from `tree.root_session_id`, so every occurrence event lands
 * under the `jobDefinitionId` aggregate the Feature 017 occurrence projection reads
 * (`occurrence-projection.ts readAggregate`), and history/show/watch reflect real
 * executions instead of an honest-empty list.
 */
export * as ExecutorReconcile from "./executor-reconcile"

import { Effect } from "effect"
import type { Overlap } from "@opencode-ai/core/jobs/overlap"
import type { OperatorJobPersistence } from "@/operator/jobs/persistence"
import type { DueContextResolver, DueRegistrationView } from "./executor-composition"
import type { DueSignal, ReconcileSource, RegistrationView } from "./bun-cron-adapter"
import type { TriggerError } from "./trigger-service"
import type {
  JobDefinitionSummary,
  JobsError,
  OperatorPrincipal,
  SchedulerError,
} from "@opencode-ai/protocol/jobs/commands"

/**
 * The in-process overlap capabilities the composed executor can enforce (`forbid`
 * always, `allow` yes; `queue`/`replace` need an occurrence layer this surface does
 * not run — mirrors `DEFAULT_ADAPTER_CAPABILITIES.in_process.overlap`).
 */
export const IN_PROCESS_OVERLAP: Overlap.OverlapCapabilities = { allow: true, queue: false, replace: false }

/** The system principal the reconcile sweep re-registers a persisted definition under. */
const SCHEDULER_PRINCIPAL: OperatorPrincipal = { kind: "system", id: "scheduler" }

/** A bounded page over every persisted definition regardless of scope (the startup sweep is global). */
const SWEEP_LIMIT = 1000

/** Project one redacted operator job summary into the cron adapter's registration intent. */
function toRegistrationView(summary: JobDefinitionSummary): RegistrationView {
  return {
    jobDefinitionId: summary.jobDefinitionId as RegistrationView["jobDefinitionId"],
    scheduleId: summary.schedule.scheduleId as RegistrationView["scheduleId"],
    schedule: summary.schedule,
    enabled: summary.enabled,
    misfirePolicy: summary.misfirePolicy,
    overlapPolicy: summary.overlapPolicy,
    principal: SCHEDULER_PRINCIPAL,
  }
}

/** Project one redacted operator job summary into the due-context view (definition-keyed aggregate). */
function toDueRegistrationView(summary: JobDefinitionSummary): DueRegistrationView {
  return {
    overlapPolicy: summary.overlapPolicy,
    // Definition-keyed durable aggregate: a scheduled occurrence's root IS its
    // definition, so events land under the `jobDefinitionId` aggregate the
    // occurrence projection reads (Group C, T010).
    rootSessionId: summary.jobDefinitionId,
    generation: 0,
    overlapCapabilities: IN_PROCESS_OVERLAP,
  }
}

/** Map a persistence `JobsError` onto a scheduler-domain `unavailable` (never a false replay). */
const toSchedulerError = (error: JobsError): SchedulerError => ({
  type: "unavailable",
  reason: error.type === "unavailable" ? error.reason : error.type,
})

/** Map a persistence `JobsError` onto a trigger-domain `unavailable` (never a fabricated occurrence). */
const toTriggerError = (error: JobsError): TriggerError => ({
  type: "unavailable",
  reason: error.type === "unavailable" ? error.reason : error.type,
})

export interface ExecutorReconcileSeams {
  readonly reconcileSource: ReconcileSource
  readonly resolveDueContext: DueContextResolver
}

/**
 * Build the executor's `reconcileSource` + `resolveDueContext` over the committed
 * operator jobs persistence. The startup sweep lists every persisted definition
 * (the cron adapter re-registers the enabled ones and compensates the disabled
 * ones); a due signal resolves the definition-keyed context, or `null` when the
 * definition is gone or disabled (dropped honestly, no claim of past execution).
 */
export function createExecutorReconcileSeams(
  persistence: OperatorJobPersistence.OperatorJobPersistence,
): ExecutorReconcileSeams {
  const reconcileSource: ReconcileSource = () =>
    persistence
      .list({ scope: "global", scopeId: "", limit: SWEEP_LIMIT })
      .pipe(
        Effect.map((out) => out.definitions.map(toRegistrationView)),
        Effect.mapError(toSchedulerError),
      )

  const resolveDueContext: DueContextResolver = (signal: DueSignal) =>
    persistence.status({ jobDefinitionId: signal.jobDefinitionId }).pipe(
      Effect.map((out): DueRegistrationView | null =>
        out.definition.enabled ? toDueRegistrationView(out.definition) : null,
      ),
      // A definition that is gone resolves to a dropped due signal, not a fault.
      Effect.catch((error) =>
        error.type === "not_found" ? Effect.succeed(null) : Effect.fail(toTriggerError(error)),
      ),
    )

  return { reconcileSource, resolveDueContext }
}
