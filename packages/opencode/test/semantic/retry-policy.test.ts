/**
 * Feature 050 / T032-T033 (FR12, AC7) — data-plane retry policy + per-batch resume.
 *
 * Exercises the REAL modules:
 *   - `withDataPlaneRetry` / `isTransientDataPlaneError` (`util/effect-http-client.ts`)
 *   - `DataPlaneRetryStats` + `retryDelta` / `accumulateConsumption` (budget path)
 *   - `EmbeddingClient.embed` + `createFetchEmbeddingsHttpClient` (per-batch retry)
 *   - `IndexJobs.runReconcile` + fake Milvus (durable content-hash resume)
 *
 * Never mocks the classifier or the budget accumulator — only the transport/port
 * seams that production injects.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { isTransientDataPlaneError, withDataPlaneRetry } from "@/util/effect-http-client"
import { DataPlaneRetryStats } from "@/semantic/data-plane-retry-stats"
import { EmbeddingClient } from "@/semantic/embedding-client"
import { createFetchEmbeddingsHttpClient } from "@/semantic/embeddings-http-client"
import { IndexJobs } from "@/semantic/index-jobs"
import { MilvusAdapter } from "@/semantic/milvus-adapter"
import { accumulateConsumption, retryDelta, ZERO_CONSUMPTION } from "@/session/budget-consume"

const filters = { projectId: "p1", scope: "project", visibility: "public" }

const liveDoc = (id: string, hash: string, dense: readonly number[] = [1, 0]): IndexJobs.LiveDoc => ({
  canonicalId: id,
  contentHash: hash,
  row: { canonicalId: id, canonicalVersion: hash, dense: [...dense], terms: [id], filters },
})

const noopSpool: IndexJobs.OutputSpoolSink = {
  spool: ({ collection, summary }) =>
    Effect.succeed(`output://semantic/${collection}/${summary.upsertedCount}-${summary.tombstonedCount}`),
}

describe("T032 — milvus_unavailable bounded retry + dimension_mismatch never-retry (AC7)", () => {
  test("milvus_unavailable retries ≤3 attempts with jittered backoff wall time", async () => {
    DataPlaneRetryStats.reset()
    let attempts = 0
    const started = performance.now()
    const failed = await Effect.runPromise(
      withDataPlaneRetry(
        Effect.suspend(() => {
          attempts += 1
          return Effect.fail({ type: "milvus_unavailable" as const, reason: "down" })
        }),
        isTransientDataPlaneError,
        { onRetry: DataPlaneRetryStats.record },
      ).pipe(Effect.flip),
    )
    const elapsedMs = performance.now() - started

    expect(failed).toEqual({ type: "milvus_unavailable", reason: "down" })
    expect(attempts).toBe(3) // 1 initial + 2 retries (MAX_DATA_PLANE_RETRIES = 2)
    // exponential(500).jittered between attempts — wall clock must clear the base delay floor
    // even under jitter (Schedule.jittered keeps a positive delay; 2 spaced retries ≫ 200ms).
    expect(elapsedMs).toBeGreaterThan(200)
    expect(DataPlaneRetryStats.snapshot().retry_count).toBe(2)
    DataPlaneRetryStats.reset()
  })

  test("taken retries fold into ConsumptionResilience.retry_count via retryDelta", async () => {
    DataPlaneRetryStats.reset()
    await Effect.runPromise(
      withDataPlaneRetry(Effect.fail({ type: "milvus_unavailable" }), isTransientDataPlaneError, {
        onRetry: DataPlaneRetryStats.record,
      }).pipe(Effect.flip),
    )
    const resilience = DataPlaneRetryStats.snapshot()
    expect(resilience.retry_count).toBe(2)

    // Same path a session turn uses: retryDelta → accumulateConsumption.
    const consumption = accumulateConsumption(ZERO_CONSUMPTION, retryDelta(resilience.retry_count))
    expect(consumption.resilience.retry_count).toBe(2)
    DataPlaneRetryStats.reset()
  })

  test("dimension_mismatch never retries and never increments retry_count", async () => {
    DataPlaneRetryStats.reset()
    let attempts = 0
    const started = performance.now()
    const failed = await Effect.runPromise(
      withDataPlaneRetry(
        Effect.suspend(() => {
          attempts += 1
          return Effect.fail({ type: "dimension_mismatch" as const, reason: "expected 2560, got 1024" })
        }),
        isTransientDataPlaneError,
        { onRetry: DataPlaneRetryStats.record },
      ).pipe(Effect.flip),
    )
    const elapsedMs = performance.now() - started

    expect(failed).toMatchObject({ type: "dimension_mismatch" })
    expect(attempts).toBe(1)
    expect(elapsedMs).toBeLessThan(100) // no backoff sleep on a domain reject
    expect(DataPlaneRetryStats.snapshot().retry_count).toBe(0)
    DataPlaneRetryStats.reset()
  })

  test("schema-reject (invalid_filters) never retries", async () => {
    let attempts = 0
    await Effect.runPromise(
      withDataPlaneRetry(
        Effect.suspend(() => {
          attempts += 1
          return Effect.fail({ type: "invalid_filters" as const, reason: "bad filter" })
        }),
        isTransientDataPlaneError,
      ).pipe(Effect.flip),
    )
    expect(attempts).toBe(1)
  })
})

describe("T033 — per-batch embed resume + durable reconcile resume (AC7)", () => {
  test("an interrupted embed batch mid-reindex retries ONLY that batch (never restarts prior batches)", async () => {
    // 5 texts, maxBatchSize=2 → batches [a,b] | [c,d] | [e]
    // Fail the second batch once (transient 503), then succeed — first batch must stay at 1 POST.
    const posts: string[][] = []
    let secondBatchFailures = 0
    const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { input: string[] }
      posts.push([...body.input])
      // Second batch inputs are ["c","d"] — fail the first time that set is seen.
      if (body.input.join(",") === "c,d" && secondBatchFailures < 1) {
        secondBatchFailures += 1
        return new Response("unavailable", { status: 503 })
      }
      return new Response(
        JSON.stringify({ data: body.input.map(() => ({ embedding: [1, 0] })) }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const http = createFetchEmbeddingsHttpClient({ fetchImpl: impl })
    const vectors = await EmbeddingClient.embed(
      { http },
      { baseUrl: "https://emb.local", model: "m", texts: ["a", "b", "c", "d", "e"], maxBatchSize: 2 },
    )

    expect(vectors).toHaveLength(5)
    // Batch 1 posted once; batch 2 posted twice (1 fail + 1 success); batch 3 once.
    expect(posts.filter((p) => p.join(",") === "a,b")).toHaveLength(1)
    expect(posts.filter((p) => p.join(",") === "c,d")).toHaveLength(2)
    expect(posts.filter((p) => p.join(",") === "e")).toHaveLength(1)
    // Whole reindex never restarts — total posts are 1+2+1, not 3× full replay.
    expect(posts).toHaveLength(4)
  })

  test("reconcile resumes from last durable step: already-indexed matching hashes are not re-upserted", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter()

    // Durable progress from a prior interrupted reindex: a+b already written.
    await Effect.runPromise(
      milvus.upsert({
        collection: "skills",
        rows: [liveDoc("skill-a", "ha", [1, 0]).row, liveDoc("skill-b", "hb", [0, 1]).row],
      }),
    )

    // Resume: live still has a,b plus unfinished c. Indexed reflects durable a+b.
    const first = await Effect.runPromise(
      IndexJobs.runReconcile(
        { milvus, spool: noopSpool },
        {
          collection: "skills",
          live: [liveDoc("skill-a", "ha", [1, 0]), liveDoc("skill-b", "hb", [0, 1]), liveDoc("skill-c", "hc", [1, 1])],
          indexed: [
            { canonicalId: "skill-a", contentHash: "ha" },
            { canonicalId: "skill-b", contentHash: "hb" },
          ],
          projectId: "p1",
          bindingVersion: 1,
        },
      ),
    )
    expect(first.summary.upsertedCount).toBe(1) // only skill-c
    expect(first.summary.unchangedCount).toBe(2)
    expect(first.summary.tombstonedCount).toBe(0)

    // Second resume with full durable state: zero mutations (idempotent).
    const second = await Effect.runPromise(
      IndexJobs.runReconcile(
        { milvus, spool: noopSpool },
        {
          collection: "skills",
          live: [liveDoc("skill-a", "ha"), liveDoc("skill-b", "hb"), liveDoc("skill-c", "hc")],
          indexed: [
            { canonicalId: "skill-a", contentHash: "ha" },
            { canonicalId: "skill-b", contentHash: "hb" },
            { canonicalId: "skill-c", contentHash: "hc" },
          ],
          projectId: "p1",
          bindingVersion: 1,
        },
      ),
    )
    expect(second.summary.upsertedCount).toBe(0)
    expect(second.summary.tombstonedCount).toBe(0)
    expect(second.summary.unchangedCount).toBe(3)

    const search = await Effect.runPromise(
      milvus.search({
        collection: "skills",
        dense: [1, 1],
        sparseTerms: [],
        filters,
        topK: 10,
        consistency: "bounded",
        metric: "cosine",
      }),
    )
    expect(search.hits.map((h) => h.canonicalId).sort()).toEqual(["skill-a", "skill-b", "skill-c"])
  })

  test("planMutations alone: partial durable progress plans upserts only for unfinished ids", () => {
    const plan = IndexJobs.planMutations(
      [liveDoc("a", "ha"), liveDoc("b", "hb"), liveDoc("c", "hc")],
      [
        { canonicalId: "a", contentHash: "ha" },
        { canonicalId: "b", contentHash: "hb" },
      ],
    )
    expect(plan.upserts.map((r) => r.canonicalId)).toEqual(["c"])
    expect(plan.unchanged).toEqual(["a", "b"])
    expect(plan.tombstones).toEqual([])
  })
})
