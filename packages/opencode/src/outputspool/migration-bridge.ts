/**
 * Feature 005 / T034 (S22) — the BackgroundJob / ToolOutputStore migration
 * bridge behind the C16 feature flag.
 *
 * One canonical V1/V2 seam with a bounded dual-read window (FR31, C16, AC12): no
 * second executor or store authority is introduced. Under the flag, a producer
 * writes an OutputRef + bounded preview + stat/status while a consumer may still
 * read the legacy `output`/`error` strings (BackgroundJob) or the path-preview
 * (ToolOutputStore) during cutover; after cutover the legacy per-content string
 * fields retire and only the OutputRef + bounded preview remain, so no
 * per-content-proportional string is retained (FR31-FR34, FR37, AC1, AC12). The
 * `MigrationState` (`enabled`, `dual_read`) is the sole gate; when it is
 * disabled the legacy path is entirely intact (rollback, plan.md "Rollback").
 *
 * The additive optional `output_ref` fields on `BackgroundJob.Info`
 * (`packages/core/src/background-job.ts`) and `ToolOutputStore.BoundResult`
 * (`packages/core/src/tool-output-store.ts`) carry the V2 handle without breaking
 * the legacy shape; this bridge owns the dual-read/dual-write projection over
 * them. The runner/registry/message-part cutover consumes this same seam at the
 * composition root — the bridge is the single mapping, not a parallel one.
 */
export * as MigrationBridge from "./migration-bridge"

import type { MigrationState } from "@opencode-ai/schema/outputspool/admin"

/** Read the C16 migration state as a plain gate (schema `MigrationState`, C16). */
export interface MigrationGate {
  readonly enabled: boolean
  readonly dual_read: boolean
}

/** Project the schema `MigrationState` value onto the plain gate; disabled means legacy-only. */
export const gateOf = (state: MigrationState | null | undefined): MigrationGate =>
  state ? { enabled: state.enabled, dual_read: state.dual_read } : { enabled: false, dual_read: false }

/** The V2 handle a producer records alongside (or in place of) a legacy string (FR31, C16). */
export interface OutputHandle {
  readonly output_ref: string
  /** Bounded redacted preview; never a path, never full content (FR4, C8, C22). */
  readonly preview: string
}

/** A legacy BackgroundJob output view (the pre-migration per-content strings). */
export interface LegacyJobOutput {
  readonly output?: string
  readonly error?: string
}

/** The migrated job-output view a consumer resolves through the bridge. */
export type JobOutputView =
  | { readonly kind: "legacy"; readonly output?: string; readonly error?: string }
  | { readonly kind: "ref"; readonly output_ref: string; readonly preview: string; readonly error?: string }
  | { readonly kind: "dual"; readonly output_ref: string; readonly preview: string; readonly output?: string; readonly error?: string }

/**
 * Resolve the effective BackgroundJob output view under the migration gate.
 * Disabled → legacy strings; enabled without dual-read → OutputRef + preview
 * only (legacy string dropped, no per-content retention); enabled with dual-read
 * → both, for the bounded cutover window (FR31, C16, AC12).
 */
export const resolveJobOutput = (
  gate: MigrationGate,
  legacy: LegacyJobOutput,
  handle: OutputHandle | null,
): JobOutputView => {
  if (!gate.enabled || handle === null) return { kind: "legacy", output: legacy.output, error: legacy.error }
  if (gate.dual_read)
    return { kind: "dual", output_ref: handle.output_ref, preview: handle.preview, output: legacy.output, error: legacy.error }
  return { kind: "ref", output_ref: handle.output_ref, preview: handle.preview, error: legacy.error }
}

/**
 * The set of legacy fields a producer persists under the gate. After cutover
 * (enabled, no dual-read) the per-content `output` string is NOT retained — only
 * the OutputRef + bounded preview survive (FR31, AC1, AC12).
 */
export interface MigratedJobRecord {
  readonly output_ref?: string
  readonly preview?: string
  readonly output?: string
  readonly error?: string
}

export const migrateJobRecord = (gate: MigrationGate, legacy: LegacyJobOutput, handle: OutputHandle | null): MigratedJobRecord => {
  if (!gate.enabled || handle === null) return { output: legacy.output, error: legacy.error }
  if (gate.dual_read) return { output_ref: handle.output_ref, preview: handle.preview, output: legacy.output, error: legacy.error }
  return { output_ref: handle.output_ref, preview: handle.preview, error: legacy.error }
}

/** True when a migrated record retains no per-content-proportional legacy string (post-cutover invariant, AC1). */
export const retainsNoLegacyContent = (record: MigratedJobRecord): boolean => record.output === undefined
