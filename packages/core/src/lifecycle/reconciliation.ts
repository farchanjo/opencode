export * as Reconciliation from "./reconciliation"

import type { Enums } from "@opencode-ai/schema/lifecycle/enums"
import type { EnumsObservation } from "@opencode-ai/schema/lifecycle/enums-observation"
import type { Ids } from "@opencode-ai/schema/lifecycle/ids"
import type { Values } from "@opencode-ai/schema/lifecycle/values"
import type { Watchdog } from "@opencode-ai/schema/lifecycle/watchdog"

/**
 * Feature 002 / T022 — explicit versioned reconciliation against durable
 * Sessions (C13, FR40, FR42).
 *
 * Pure domain: no I/O. The caller (the eventv2-adapter, T025, or a restart
 * bootstrap) supplies the already-observed `durable_version` (read via
 * `EventV2.readAggregate` against the durable Session aggregate) and the
 * process's prior in-memory state; this module only decides the outcome and
 * builds the `ReconcileRecord`. `auto_retry` is pinned `false` on every
 * record the schema accepts (`Watchdog.ReconcileRecord.auto_retry:
 * Schema.Literal(false)`) — reconciliation NEVER re-executes an effect after a
 * zombie or crash (FR40).
 *
 * Reconciliation only ever confirms or reports `unknown`; it never invents,
 * regresses, or upgrades a Process Table state — `zombie_detected` and
 * `owner_lost` stay the shared watchdog's own outcomes (C12, T021), never
 * reconciliation's (see `doc/arch/statecharts/task-lifecycle.md` "reconciled
 * does not appear as an edge").
 */

/** The five absorbing terminal Process Table states (statechart `[*]` exits). */
export const ABSORBING_STATES: ReadonlyArray<Enums.ProcessState> = [
  "completed",
  "failed",
  "cancelled",
  "zombie",
  "unknown",
]

export function isAbsorbing(state: Enums.ProcessState): boolean {
  return (ABSORBING_STATES as ReadonlyArray<string>).includes(state)
}

/** A reconciliation outcome is restricted to this module's own decision space. */
export type ReconciliationOutcome = Extract<EnumsObservation.WatchdogOutcome, "reconciled" | "unknown">

export interface ReconciliationInput {
  readonly process_id: Ids.ProcessId
  /** The last durable Session version this process was reconciled against. */
  readonly from_version: Values.SchemaVersion
  /** The current durable Session version observed via `EventV2.readAggregate`. */
  readonly durable_version: Values.SchemaVersion
  /** The Process Table's in-memory state before reconciliation. */
  readonly prior_state: Enums.ProcessState
  /** Whether a live runtime owner (heartbeat/lease) is currently observed for this process. */
  readonly owner_present: boolean
}

function decideOutcome(input: ReconciliationInput): ReconciliationOutcome {
  // A version gap means the local view has fallen behind the durable Session
  // in a way this reconciliation pass cannot safely confirm; report unknown
  // rather than guess (never invents or regresses state, C9, C13).
  if (input.durable_version !== input.from_version) return "unknown"

  // An absorbing terminal row confirmed at the same version is reconciled —
  // reconciliation never regresses a terminal state (statechart note).
  if (isAbsorbing(input.prior_state)) return "reconciled"

  // A non-terminal row with no live owner represents lost process-local
  // registry state after a restart or crash: unknown/unreconciled, no retry
  // (FR40, FR42, AC13).
  if (!input.owner_present) return "unknown"

  // A non-terminal row with a live owner at the same version is confirmed
  // in sync with the durable Session.
  return "reconciled"
}

/** Reconcile one process against its durable Session version. Pure, total, no I/O. */
export function reconcileProcess(input: ReconciliationInput): Watchdog.ReconcileRecord {
  return {
    process_id: input.process_id,
    outcome: decideOutcome(input),
    from_version: input.durable_version,
    auto_retry: false,
  }
}

/** Reconcile a batch of processes (e.g. every row after a restart bootstrap). */
export function reconcileBatch(
  inputs: ReadonlyArray<ReconciliationInput>,
): ReadonlyArray<Watchdog.ReconcileRecord> {
  return inputs.map(reconcileProcess)
}
