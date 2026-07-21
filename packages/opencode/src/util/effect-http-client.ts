import { Effect, Schedule } from "effect"
import { HttpClient } from "effect/unstable/http"

export const withTransientReadRetry = <E, R>(client: HttpClient.HttpClient.With<E, R>) =>
  client.pipe(
    HttpClient.retryTransient({
      retryOn: "errors-and-responses",
      times: 2,
      schedule: Schedule.exponential(200).pipe(Schedule.jittered),
    }),
  )

/**
 * Feature 050 (FR12) — the data-plane retry classification.
 *
 * The transient set (transport/timeout, HTTP 429/5xx, `milvus_unavailable`) is
 * retryable; the domain set (`invalid_filters`, `dimension_mismatch`,
 * `reranker_not_eligible`, `cas_conflict`, and any HTTP 4xx client reject) NEVER
 * retries — a blind retry of a domain error only burns budget and hides a real
 * fault. `cas_conflict` is deliberately domain here: the caller re-reads the
 * current version and re-plans before a single retry, never a blind retry.
 */
const TRANSIENT_TYPES: ReadonlySet<string> = new Set(["milvus_unavailable", "transport", "timeout", "http_server"])
const DOMAIN_TYPES: ReadonlySet<string> = new Set([
  "invalid_filters",
  "dimension_mismatch",
  "reranker_not_eligible",
  "cas_conflict",
  "http_client",
  "malformed",
])

/** True when an error is a transient data-plane fault safe to retry within the operation deadline (FR12). */
export const isTransientDataPlaneError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false
  const type = (error as { type?: unknown }).type
  if (typeof type === "string") {
    if (DOMAIN_TYPES.has(type)) return false
    if (TRANSIENT_TYPES.has(type)) return true
  }
  const status = (error as { status?: unknown }).status
  if (typeof status === "number") return status === 429 || (status >= 500 && status < 600)
  return false
}

/**
 * Feature 050 (FR12) — a bounded, jittered-exponential data-plane retry over a
 * plain `Effect.Effect<A, E>`, the sibling to `withTransientReadRetry` for the
 * non-`HttpClient` seams (`MilvusPort`, embed batches, reconcile). Up to three
 * total attempts (1 + 2 retries), 500ms base, jittered, and ONLY while the error
 * is transient (`isTransient`); a domain error stops immediately (FR12).
 */
export const withDataPlaneRetry = <A, E>(
  effect: Effect.Effect<A, E>,
  isTransient: (error: E) => boolean,
): Effect.Effect<A, E> =>
  Effect.retry(effect, {
    schedule: Schedule.exponential(500).pipe(Schedule.jittered),
    times: 2,
    while: isTransient,
  })

/**
 * Promise-facing convenience over {@link withDataPlaneRetry}: retries a
 * Promise-returning operation under the same bounded transient-only policy and
 * resolves/rejects with the underlying value/error. Used by the production
 * embeddings HTTP client so the retry policy has exactly one owner (FR12).
 */
export const retryDataPlanePromise = <A>(
  run: () => Promise<A>,
  isTransient: (error: unknown) => boolean,
): Promise<A> =>
  Effect.runPromise(withDataPlaneRetry(Effect.tryPromise({ try: run, catch: (error) => error }), isTransient))
