/**
 * Feature 005 / T029 (S17) — startup crash-recovery reconciler.
 *
 * Runs at startup over every open/sealing group in the control store, applies
 * the framework-free domain reconciliation policy
 * (`@opencode-ai/core/outputspool/reconcile`, T022) against the control-store
 * committed-length authority and the observed filesystem data extent, marks each
 * group `sealed`/`open`/`aborted`/`corrupt`/`unknown`, and emits one
 * `output.reconciled` durable settlement projection per group — never a silent
 * empty-success (FR25, C12, AC8, AC9). A crash after seal before its event
 * settles as a visible sealed ref (the seal record survives in the control
 * store, so the reconciler re-emits the settlement, C12, AC9).
 *
 * The filesystem-extent probe and the settlement emitter are injected so the
 * reconciler is deterministic under injected crash points; the live stack binds
 * the real spool-file `stat` and the `publishOutputEvent` boundary (T031).
 */
export * as Reconciler from "./reconciler"

import { Reconcile } from "@opencode-ai/core/outputspool/reconcile"
import type { ControlStore } from "./control-store"

/** The bounded recovery-scan limit (provisional plan constant, C12, AC8). */
export const DEFAULT_SCAN_LIMIT = 4096

/** One reconciled group: its ref, correlation id, recovery outcome, and committed length. */
export interface ReconcileSettlement {
  readonly output_ref: string
  readonly correlation_id: string
  readonly outcome: Reconcile.RecoveryOutcome
  readonly committed_bytes: number
  readonly recovered_extent: number
}

export interface ReconcilerDeps {
  readonly store: ControlStore.ControlStore
  /** The observed filesystem data extent for a channel generation (0 when the file is absent). */
  readonly extentOf: (output_ref: string) => number | Promise<number>
  /** The settlement emitter; the live stack projects `output.reconciled` (T031). */
  readonly emit?: (settlement: ReconcileSettlement) => void | Promise<void>
  readonly scanLimit?: number
  readonly now?: () => number
}

export interface Reconciler {
  readonly run: () => Promise<readonly ReconcileSettlement[]>
}

/** Build the startup reconciler over the control store and injected extent/emit seams. */
export const createReconciler = (deps: ReconcilerDeps): Reconciler => {
  const now = deps.now ?? Date.now
  const scanLimit = deps.scanLimit ?? DEFAULT_SCAN_LIMIT

  const run = async (): Promise<readonly ReconcileSettlement[]> => {
    const open = deps.store.listOpen()
    const settlements: ReconcileSettlement[] = []
    for (const record of open) {
      const extent = await deps.extentOf(record.output_ref)
      const input: Reconcile.ReconcileInput = {
        committed_bytes: record.committed_bytes,
        fs_extent: extent,
        seal_record_present: record.seal_record,
        abort_record_present: record.abort_record,
        seal_requested: record.seal_requested,
        scan_complete: Reconcile.withinScanLimit(extent, scanLimit),
      }
      const result = Reconcile.reconcile(input)
      deps.store.setState(record.output_ref, result.outcome, now())
      const settlement: ReconcileSettlement = {
        output_ref: record.output_ref,
        correlation_id: record.correlation_id,
        outcome: result.outcome,
        committed_bytes: result.committed_bytes,
        recovered_extent: result.recovered_extent,
      }
      if (deps.emit) await deps.emit(settlement)
      settlements.push(settlement)
    }
    return settlements
  }

  return { run }
}
