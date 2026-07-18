/**
 * Feature 003 / T015 (S7) — misfire policy evaluator.
 *
 * Framework-free, deterministic, zero I/O. Evaluates the four misfire policies
 * `skip | fire_once | bounded_catch_up | coalesce` over the set of nominal due
 * instants that elapsed while the scheduler was down or a handler was pending,
 * and decides which occurrences fire and which resolve to an explicit no-fire
 * terminal (`misfired` / `skipped` / `coalesced`). A bounded catch-up ceiling
 * guarantees NO infinite catch-up (FR15, C19, AC3, AC24): overflow beyond the
 * ceiling is dropped as an explicit `misfired` outcome, never silently queued.
 *
 * The provisional ceiling and default policy are exported as explicit,
 * overridable data constants — never inlined into the algorithm (data-model
 * "Parameters", plan Non-goals).
 */
export * as Misfire from "./misfire"

import type { MisfirePolicy, OccurrenceState } from "@opencode-ai/schema/jobs/enums"

export type { MisfirePolicy, OccurrenceState }

/** Provisional default misfire policy (AC3); explicit, overridable data. */
export const DEFAULT_MISFIRE_POLICY: MisfirePolicy = "skip"

/** Provisional bounded catch-up ceiling (AC3, AC21); never infinite. */
export const DEFAULT_CATCH_UP_CEILING = 16 as const

/** Absolute hard ceiling: no configuration may request more than this many catch-up fires (C19). */
export const MAX_CATCH_UP_CEILING = 256 as const

/** The action taken for one elapsed nominal due instant. */
export type MisfireAction = "fire" | "skip" | "coalesce" | "drop_over_ceiling"

/** The per-instant decision, carrying both the action and the resulting occurrence outcome. */
export interface MisfireEntry {
  /** The canonical nominal-due string key (see `Cron.nominalDueKey`). */
  readonly nominalDueTime: string
  readonly action: MisfireAction
  /**
   * The occurrence outcome this entry implies: `claimed` when it fires (the
   * occurrence proceeds), otherwise an absorbing no-fire terminal.
   */
  readonly outcome: Extract<OccurrenceState, "claimed" | "misfired" | "skipped" | "coalesced">
}

export interface MisfireInput {
  readonly policy: MisfirePolicy
  /** Elapsed nominal due instants, oldest first (canonical string keys). */
  readonly missedNominalTimes: readonly string[]
  /** Bounded catch-up ceiling; floored to `[0, MAX_CATCH_UP_CEILING]`. */
  readonly catchUpCeiling?: number
}

export interface MisfireDecision {
  readonly entries: readonly MisfireEntry[]
  /** Count of instants that actually fire (proceed to `claimed`). */
  readonly firedCount: number
  /** Count of instants dropped because they exceeded the bounded ceiling. */
  readonly droppedOverCeiling: number
}

const entry = (nominalDueTime: string, action: MisfireAction, outcome: MisfireEntry["outcome"]): MisfireEntry =>
  Object.freeze({ nominalDueTime, action, outcome })

const clampCeiling = (value: number | undefined): number => {
  const raw = value ?? DEFAULT_CATCH_UP_CEILING
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.min(Math.floor(raw), MAX_CATCH_UP_CEILING)
}

/**
 * Evaluate the misfire policy over the elapsed nominal instants. Pure and
 * total; returns a per-instant decision list plus fired/dropped counts:
 *   - `skip` — fire none; every instant resolves to `skipped`.
 *   - `fire_once` — fire only the most recent instant (`claimed`); older ones
 *     resolve to `misfired` (a single catch-up, never a burst).
 *   - `coalesce` — fire only the most recent instant (`claimed`); older ones
 *     resolve to `coalesced` (collapsed into the representative fire).
 *   - `bounded_catch_up` — fire the newest `min(count, ceiling)` instants
 *     (`claimed`), oldest of the fired window first; any excess beyond the
 *     ceiling is `drop_over_ceiling` / `misfired`. NEVER infinite (C19, AC24).
 */
export const evaluateMisfire = (input: MisfireInput): MisfireDecision => {
  const missed = input.missedNominalTimes
  if (missed.length === 0) return Object.freeze({ entries: [], firedCount: 0, droppedOverCeiling: 0 })

  const lastIndex = missed.length - 1
  switch (input.policy) {
    case "skip": {
      const entries = missed.map((t) => entry(t, "skip", "skipped"))
      return Object.freeze({ entries, firedCount: 0, droppedOverCeiling: 0 })
    }
    case "fire_once": {
      const entries = missed.map((t, i) => (i === lastIndex ? entry(t, "fire", "claimed") : entry(t, "skip", "misfired")))
      return Object.freeze({ entries, firedCount: 1, droppedOverCeiling: 0 })
    }
    case "coalesce": {
      const entries = missed.map((t, i) =>
        i === lastIndex ? entry(t, "fire", "claimed") : entry(t, "coalesce", "coalesced"),
      )
      return Object.freeze({ entries, firedCount: 1, droppedOverCeiling: 0 })
    }
    case "bounded_catch_up": {
      const ceiling = clampCeiling(input.catchUpCeiling)
      // Fire the newest `ceiling` instants; anything older overflows the ceiling.
      const firstFiredIndex = Math.max(0, missed.length - ceiling)
      let dropped = 0
      const entries = missed.map((t, i) => {
        if (i < firstFiredIndex) {
          dropped += 1
          return entry(t, "drop_over_ceiling", "misfired")
        }
        return entry(t, "fire", "claimed")
      })
      return Object.freeze({ entries, firedCount: missed.length - dropped, droppedOverCeiling: dropped })
    }
  }
}
