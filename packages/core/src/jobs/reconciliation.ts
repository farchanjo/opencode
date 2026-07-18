/**
 * Feature 003 / T016 (S8) — startup registration & occurrence reconciliation.
 *
 * Framework-free, deterministic, zero I/O. Mirrors the Feature 002
 * reconciliation posture (`packages/core/src/lifecycle/reconciliation.ts`): the
 * caller supplies the already-observed durable version and the prior state, and
 * this module only decides the outcome and builds the record. `auto_retry` is
 * pinned `false` on every record the schema accepts
 * (`Reconciliation.OccurrenceReconcile.auto_retry` / `RegistrationReconcile.
 * auto_retry` = `Schema.Literal(false)`) — reconciliation NEVER re-executes an
 * ambiguous mutating effect after a crash (FR14, C11, AC19, AC23).
 *
 * Reconciliation only ever confirms or reports `unknown`; it never invents,
 * regresses, or upgrades an occurrence or registration state. No transaction
 * spans Config.Service and the scheduler — the registration is an idempotent
 * external effect paired with compensation, and an unconfirmed effect surfaces
 * as `unknown`, never a false claim of cross-system atomicity (C5, AC23).
 */
export * as Reconciliation from "./reconciliation"

import type { OccurrenceState, ReconcileOutcome, RegistrationState } from "@opencode-ai/schema/jobs/enums"
import type { JobDefinitionId, OccurrenceId, ScheduleId } from "@opencode-ai/schema/jobs/ids"
import type { OccurrenceReconcile, RegistrationReconcile } from "@opencode-ai/schema/jobs/reconciliation"
import type { SchemaVersion } from "@opencode-ai/schema/jobs/values"
import { OccurrenceStateMachine } from "./occurrence-state-machine"

// =============================================================================
// Registration reconciliation (FR6, C5, AC23)
// =============================================================================

export interface RegistrationReconcileInput {
  readonly job_definition_id: JobDefinitionId
  readonly schedule_id: ScheduleId
  /** Durable intent: an enabled definition should have a live external registration. */
  readonly enabled: boolean
  /** The registration state before this reconciliation pass. */
  readonly prior_state: RegistrationState
  /** Whether the external Bun/OS registration is currently observed live. */
  readonly external_present: boolean
}

/**
 * Decide a registration outcome: the durable intent (`enabled`) and the
 * observed external effect (`external_present`) agree → `reconciled`; they
 * disagree → `unknown` (an enabled definition whose registration could not be
 * confirmed, or a disabled one whose compensation is unconfirmed). No cross-
 * system atomicity is claimed (C5, AC23).
 */
const decideRegistrationOutcome = (input: RegistrationReconcileInput): ReconcileOutcome =>
  input.enabled === input.external_present ? "reconciled" : "unknown"

/** Reconcile one schedule registration. Pure, total, no I/O; `auto_retry` pinned false. */
export const reconcileRegistration = (input: RegistrationReconcileInput): RegistrationReconcile => ({
  job_definition_id: input.job_definition_id,
  schedule_id: input.schedule_id,
  outcome: decideRegistrationOutcome(input),
  from_state: input.prior_state,
  auto_retry: false,
})

/** Reconcile a batch of registrations (e.g. every enabled definition after a restart). */
export const reconcileRegistrationBatch = (
  inputs: readonly RegistrationReconcileInput[],
): readonly RegistrationReconcile[] => inputs.map(reconcileRegistration)

// =============================================================================
// Occurrence reconciliation (FR14, C5, AC19)
// =============================================================================

export interface OccurrenceReconcileInput {
  readonly occurrence_id: OccurrenceId
  /** The last durable version this occurrence was reconciled against. */
  readonly from_version: SchemaVersion
  /** The current durable version observed via `EventV2.readAggregate`. */
  readonly durable_version: SchemaVersion
  /** The occurrence state before reconciliation. */
  readonly prior_state: OccurrenceState
  /**
   * Whether a Feature 002 Task Process was confirmed associated (the occurrence
   * reached admission/dispatch). A claimed-but-undispatched occurrence after a
   * crash cannot be safely confirmed.
   */
  readonly dispatched: boolean
}

/**
 * Decide an occurrence outcome:
 *   - A version gap means the local view fell behind the durable aggregate in a
 *     way this pass cannot safely confirm → `unknown` (never guess, C5).
 *   - An absorbing terminal at the same version → `reconciled` (confirm, never
 *     regress a terminal state).
 *   - A non-terminal occurrence never confirmed as dispatched → `unknown`: a
 *     crash between claim and dispatch replays no ambiguous mutation (FR14,
 *     AC19, AC20).
 *   - A non-terminal occurrence with a confirmed dispatch at the same version →
 *     `reconciled` (in sync with the durable aggregate).
 */
const decideOccurrenceOutcome = (input: OccurrenceReconcileInput): ReconcileOutcome => {
  if (input.durable_version !== input.from_version) return "unknown"
  if (OccurrenceStateMachine.isTerminal(input.prior_state)) return "reconciled"
  if (!input.dispatched) return "unknown"
  return "reconciled"
}

/** Reconcile one occurrence against its durable version. Pure, total; `auto_retry` pinned false. */
export const reconcileOccurrence = (input: OccurrenceReconcileInput): OccurrenceReconcile => ({
  occurrence_id: input.occurrence_id,
  outcome: decideOccurrenceOutcome(input),
  from_version: input.durable_version,
  auto_retry: false,
})

/** Reconcile a batch of occurrences (e.g. every non-terminal row after a restart bootstrap). */
export const reconcileOccurrenceBatch = (
  inputs: readonly OccurrenceReconcileInput[],
): readonly OccurrenceReconcile[] => inputs.map(reconcileOccurrence)
