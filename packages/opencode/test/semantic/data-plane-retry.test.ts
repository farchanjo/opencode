/**
 * Feature 050 / T007-T008 (FR12) — the data-plane retry helper.
 *
 * Asserts the bounded transient-only policy: a transient fault retries up to the
 * ≤3-attempt bound (1 + 2 retries), a domain error never retries, `cas_conflict`
 * is excluded from blind retry, and the transient classifier honors HTTP 429/5xx
 * vs 4xx.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { isTransientDataPlaneError, withDataPlaneRetry } from "@/util/effect-http-client"

async function runAttempts(makeError: (attempt: number) => unknown, isTransient: (e: unknown) => boolean): Promise<number> {
  let attempts = 0
  const effect = Effect.suspend(() => {
    attempts += 1
    return Effect.fail(makeError(attempts))
  })
  await Effect.runPromise(withDataPlaneRetry(effect, isTransient).pipe(Effect.flip))
  return attempts
}

describe("withDataPlaneRetry", () => {
  test("retries a transient fault up to the ≤3-attempt bound", async () => {
    const attempts = await runAttempts(() => ({ type: "milvus_unavailable", reason: "down" }), isTransientDataPlaneError)
    expect(attempts).toBe(3)
  })

  test("never retries a domain error", async () => {
    for (const type of ["invalid_filters", "dimension_mismatch", "reranker_not_eligible"]) {
      const attempts = await runAttempts(() => ({ type, reason: "domain" }), isTransientDataPlaneError)
      expect(attempts).toBe(1)
    }
  })

  test("never blind-retries a cas_conflict", async () => {
    const attempts = await runAttempts(() => ({ type: "cas_conflict", reason: "moved" }), isTransientDataPlaneError)
    expect(attempts).toBe(1)
  })

  test("stops retrying once the fault turns domain", async () => {
    const attempts = await runAttempts(
      (attempt) => (attempt >= 2 ? { type: "dimension_mismatch" } : { type: "milvus_unavailable" }),
      isTransientDataPlaneError,
    )
    // attempt 1 transient → retry; attempt 2 domain → stop.
    expect(attempts).toBe(2)
  })

  test("succeeds without retry when the effect passes", async () => {
    let attempts = 0
    const result = await Effect.runPromise(
      withDataPlaneRetry(
        Effect.suspend(() => {
          attempts += 1
          return Effect.succeed("ok")
        }),
        isTransientDataPlaneError,
      ),
    )
    expect(result).toBe("ok")
    expect(attempts).toBe(1)
  })
})

describe("isTransientDataPlaneError", () => {
  test("classifies transient types and HTTP 429/5xx as retryable", () => {
    expect(isTransientDataPlaneError({ type: "transport" })).toBe(true)
    expect(isTransientDataPlaneError({ type: "http_server", status: 503 })).toBe(true)
    expect(isTransientDataPlaneError({ status: 429 })).toBe(true)
    expect(isTransientDataPlaneError({ status: 500 })).toBe(true)
  })

  test("classifies domain types and HTTP 4xx as non-retryable", () => {
    expect(isTransientDataPlaneError({ type: "cas_conflict" })).toBe(false)
    expect(isTransientDataPlaneError({ type: "http_client", status: 400 })).toBe(false)
    expect(isTransientDataPlaneError({ status: 404 })).toBe(false)
    expect(isTransientDataPlaneError("boom")).toBe(false)
  })
})
