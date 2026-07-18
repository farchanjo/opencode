/**
 * Feature 005 / T022 (S12) — crash reconciliation policy (committed-length
 * authority).
 *
 * Framework-free, deterministic, zero I/O. Mirrors the Feature 003
 * (`jobs/reconciliation.ts`) and Feature 002 (`lifecycle/reconciliation.ts`)
 * posture: the caller supplies the observed control-store committed length, the
 * filesystem data extent, and the seal/abort fence records, and this module only
 * decides the recovery outcome — it never re-executes an effect or invents a
 * false success (FR25, C12, AC8, AC9).
 *
 * The control-store committed length is the recovery authority (C12). Recovery
 * reconciles the filesystem extent against it into exactly one of `sealed`,
 * `open`, `aborted`, `corrupt`, or `unknown` — never a silent empty-success
 * (FR25, C12):
 *   - extent ≥ committed and a seal record present → `sealed`;
 *   - extent ≥ committed and an abort record present → `aborted`;
 *   - extent ≥ committed, no terminal record, no seal intent → `open`;
 *   - extent < committed (data shorter than the authority) → `corrupt`;
 *   - a seal was requested but no seal record survived, or the bounded recovery
 *     scan did not complete → `unknown`.
 */
export * as Reconcile from "./reconcile"

import type { GroupState } from "@opencode-ai/schema/outputspool/enums"

/** The one recovery outcome a group reconciles into (a subset of `GroupState`). */
export type RecoveryOutcome = Extract<GroupState, "sealed" | "open" | "aborted" | "corrupt" | "unknown">

/** The observed inputs for reconciling one channel generation after a crash. */
export interface ReconcileInput {
  /** The control-store committed-length authority for the generation (C12). */
  readonly committed_bytes: number
  /** The filesystem data extent observed on recovery. */
  readonly fs_extent: number
  readonly seal_record_present: boolean
  readonly abort_record_present: boolean
  /** Whether a terminal seal was requested before the crash (terminal intent). */
  readonly seal_requested: boolean
  /** Whether the bounded recovery scan completed within its limit (C12, AC8). */
  readonly scan_complete: boolean
}

/** Whether a recovery scan stayed within its bounded limit. */
export const withinScanLimit = (scanned: number, scan_limit: number): boolean => scanned <= scan_limit

/**
 * Decide a recovery outcome from the committed-length authority and the observed
 * extent and records. Pure and total; never a silent empty-success (FR25, C12,
 * AC8, AC9).
 */
export const decide = (input: ReconcileInput): RecoveryOutcome => {
  if (!input.scan_complete) return "unknown"
  if (input.fs_extent < input.committed_bytes) return "corrupt"
  if (input.seal_record_present) return "sealed"
  if (input.abort_record_present) return "aborted"
  if (input.seal_requested) return "unknown"
  return "open"
}

/** A reconciliation record: the outcome plus the authoritative committed length. */
export interface ReconcileRecord {
  readonly outcome: RecoveryOutcome
  readonly committed_bytes: number
  readonly recovered_extent: number
}

/** Reconcile one channel generation. Pure, total; the committed length is carried, never re-authored. */
export const reconcile = (input: ReconcileInput): ReconcileRecord =>
  Object.freeze({ outcome: decide(input), committed_bytes: input.committed_bytes, recovered_extent: input.fs_extent })

/** Reconcile a batch of generations (e.g. every open group after a restart bootstrap). */
export const reconcileBatch = (inputs: readonly ReconcileInput[]): readonly ReconcileRecord[] =>
  Object.freeze(inputs.map(reconcile))
