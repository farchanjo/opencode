/**
 * Feature 008 / T015 (S7) — the reconnect-backoff planner.
 *
 * Encodes the bounded exponential backoff curve with jitter and a capped max delay
 * drawn in `plan.md` "State machines" (FR29, FR30, FR31, C14). Pure and
 * deterministic: the wall clock and the jitter source are injected VALUES
 * (`nowMillis`, `jitterRatio`) supplied by the `packages/opencode` `ClockPort` /
 * `EntropyPort` seams, never read here — mirroring the pure-value discipline of
 * `packages/core/src/semantic/degradation.ts`.
 *
 * A Streamable HTTP drop enters `reconnecting` and retries under the curve honoring
 * session resume and `Last-Event-ID`; the attempt cap reaches `failed`. A stdio
 * connection has NO backoff schedule — it restarts under lifecycle control with
 * child cleanup, so `planStdioRestart` returns an immediate zero-delay restart with
 * a cleanup marker and never a backoff attempt (FR30, FR31, C14).
 */
export * as ReconnectPlanner from "./reconnect-planner"

/** The bounded backoff parameters; exact bounds are provisional plan constants (C14). */
export interface BackoffConfig {
  /** The base delay in millis for attempt 0 (the first retry). */
  readonly baseMillis: number
  /** The hard cap the exponential term is clamped to before jitter (C14). */
  readonly capMillis: number
  /** The maximum reconnect attempts before the lifecycle reaches `failed` (C14). */
  readonly maxAttempts: number
  /** The jitter fraction of the capped delay, in `[0, 1]` (C14). */
  readonly jitterRatio: number
}

/** A sane default curve; the application layer may override every bound (C14). */
export const DEFAULT_BACKOFF: BackoffConfig = Object.freeze({
  baseMillis: 500,
  capMillis: 30_000,
  maxAttempts: 8,
  jitterRatio: 0.2,
})

/** The session-resume state carried across a Streamable HTTP reconnect (FR29, C14). */
export interface ResumeState {
  readonly lastEventId: string | null
  readonly sessionId: string | null
  readonly resumeSupported: boolean
}

/**
 * The exponential-plus-cap base delay for `attempt` (0-based), BEFORE jitter. The
 * exponential term `baseMillis * 2^attempt` is clamped to `capMillis` so the curve
 * is bounded and monotonic non-decreasing (C14). A negative attempt clamps to 0.
 */
export const cappedDelay = (attempt: number, config: BackoffConfig): number => {
  const safeAttempt = attempt < 0 ? 0 : attempt
  const exponential = config.baseMillis * 2 ** safeAttempt
  return Math.min(exponential, config.capMillis)
}

/**
 * The full backoff delay for `attempt` with jitter applied. Jitter adds up to
 * `jitterRatio` of the capped delay using the injected `jitterRatio` value in
 * `[0, 1)`, keeping the result within `[capped, capped * (1 + jitterRatio)]` and
 * never below the capped floor (C14). Pure.
 */
export const delayWithJitter = (attempt: number, config: BackoffConfig, jitterRatio: number): number => {
  const capped = cappedDelay(attempt, config)
  const clampedJitter = Math.min(Math.max(jitterRatio, 0), 1)
  const spread = Math.round(capped * config.jitterRatio * clampedJitter)
  return capped + spread
}

/** The next reconnect decision under the bounded curve (FR29, FR30, C14). */
export type ReconnectDecision =
  | {
      readonly kind: "retry"
      readonly attempt: number
      readonly delayMillis: number
      readonly resume: ResumeState
    }
  | { readonly kind: "failed"; readonly attempt: number }

/**
 * Plan the next Streamable HTTP reconnect. Below the attempt cap it schedules a
 * jittered retry that carries the resume state (`Last-Event-ID` + session id) so
 * negotiation resumes rather than restarts; at or beyond the cap it reaches
 * `failed`. `attempt` is the count already made (0 = first retry) (FR29, FR30, C14).
 */
export const planReconnect = (
  attempt: number,
  config: BackoffConfig,
  jitterRatio: number,
  resume: ResumeState,
): ReconnectDecision =>
  attempt >= config.maxAttempts
    ? Object.freeze({ kind: "failed", attempt })
    : Object.freeze({
        kind: "retry",
        attempt: attempt + 1,
        delayMillis: delayWithJitter(attempt, config, jitterRatio),
        resume: Object.freeze({
          lastEventId: resume.resumeSupported ? resume.lastEventId : null,
          sessionId: resume.sessionId,
          resumeSupported: resume.resumeSupported,
        }),
      })

/**
 * The stdio restart decision: NO backoff schedule. A stdio connection restarts
 * immediately under lifecycle control and the caller must clean up the prior child
 * process (`cleanupChild`) before re-spawning (FR30, FR31, C14).
 */
export interface StdioRestart {
  readonly kind: "stdio_restart"
  readonly delayMillis: 0
  readonly cleanupChild: true
}

/** Plan a stdio restart — always immediate, always with child cleanup, never backoff (FR31, C14). */
export const planStdioRestart = (): StdioRestart => Object.freeze({ kind: "stdio_restart", delayMillis: 0, cleanupChild: true })
