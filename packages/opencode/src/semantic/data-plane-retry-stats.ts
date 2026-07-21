/**
 * Feature 050 / T024 (FR12) — the data-plane retry counter surface.
 *
 * Activates the previously-inert `ConsumptionResilience.retry_count`
 * (`budget-consume.ts` `retryDelta`/`accumulateConsumption`, which had no
 * production caller): every semantic data-plane retry taken by
 * `withDataPlaneRetry` (embed batches, `enumerateIndexed`, the reconcile
 * upsert/tombstone path, `buildGeneration`) folds ONE `retryDelta` onto a
 * module-scoped `Budget.Consumption` accumulator through the SAME
 * `accumulateConsumption` path a session turn uses — so `retry_count` is a real,
 * non-zero-observable signal for the first time (FR12, AC7).
 *
 * The counter is process-scoped (one opencode instance owns index maintenance
 * per profile, `research.md` single-writer assumption). The operator boundary
 * reads `snapshot()` after a reindex/reconcile to surface the resilience delta on
 * the job audit; `reset()` bounds it per run.
 */
export * as DataPlaneRetryStats from "./data-plane-retry-stats"

import type { Budget } from "@opencode-ai/schema/routing/budget"
import { accumulateConsumption, retryDelta, ZERO_CONSUMPTION } from "@/session/budget-consume"

let consumption: Budget.Consumption = ZERO_CONSUMPTION

/** Record one taken data-plane retry into `resilience.retry_count` via the shared accumulation path (FR12). */
export const record = (count = 1): void => {
  consumption = accumulateConsumption(consumption, retryDelta(count))
}

/** The current resilience running total — `retry_count` is the observable AC7 signal. */
export const snapshot = (): Budget.Consumption["resilience"] => consumption.resilience

/** Reset the accumulator (bounds the count per reindex/reconcile run). */
export const reset = (): void => {
  consumption = ZERO_CONSUMPTION
}
