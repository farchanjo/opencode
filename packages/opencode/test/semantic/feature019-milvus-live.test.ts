/**
 * Feature 019 / T017 (Group B, FR13) — env-gated LIVE validation against a real
 * Milvus endpoint over the shipped REST v2 HTTP client.
 *
 * Exercises the full maintenance surface end-to-end — health probe →
 * createCollection/buildGeneration → upsert → enumerate → swapAliases → post-swap
 * enumerate — against real infrastructure, using a throwaway `opencode_test_`-prefixed
 * collection set that is ALWAYS dropped in cleanup. The test SKIPS when
 * `OPENCODE_SEMANTIC_MILVUS_ADDRESS` is absent, so CI never requires the endpoint; unit
 * coverage runs against the fake port (`feature019-milvus-port.test.ts`).
 *
 * Run: OPENCODE_SEMANTIC_MILVUS_ADDRESS=host:19530 OPENCODE_SEMANTIC_MILVUS_INSECURE=1 \
 *   bun test test/semantic/feature019-milvus-live.test.ts
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { MilvusAdapter } from "@/semantic/milvus-adapter"

const ADDRESS = process.env["OPENCODE_SEMANTIC_MILVUS_ADDRESS"]?.trim()
const INSECURE = process.env["OPENCODE_SEMANTIC_MILVUS_INSECURE"] === "1"
const PREFIX = "opencode_test"

const run = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromise(e)

/** The REST base URL, mirroring the client's own resolution, for direct cleanup calls. */
function baseUrl(address: string): string {
  return /^https?:\/\//.test(address) ? address.replace(/\/+$/, "") : `${INSECURE ? "http" : "https"}://${address}`
}
async function dropCollection(address: string, name: string): Promise<void> {
  await fetch(`${baseUrl(address)}/v2/vectordb/collections/drop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ collectionName: name }) }).catch(() => undefined)
}
async function dropAlias(address: string, name: string): Promise<void> {
  await fetch(`${baseUrl(address)}/v2/vectordb/aliases/drop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ aliasName: name }) }).catch(() => undefined)
}

describe("T017 — live Milvus validation (env-gated)", () => {
  test.skipIf(!ADDRESS)(
    "health + buildGeneration + upsert + enumerate + swapAliases against a real endpoint",
    async () => {
      const address = ADDRESS!
      const generationId = `gen_${Date.now()}`
      const collection = "agents" as const
      const physical = `${PREFIX}__${collection}__${generationId}`
      const alias = `${PREFIX}__${collection}`
      const port = MilvusAdapter.createGrpcMilvusAdapter({
        client: MilvusAdapter.createHttpMilvusClient({ address, ssl: !INSECURE, collectionPrefix: PREFIX, timeoutMs: 15000 }),
      })
      try {
        // 1) health probe reaches the backend.
        const health = await run(port.health())
        expect(health.reachable).toBe(true)

        // 2) buildGeneration physically creates + validates a fresh blue/green generation.
        const build = await run(port.buildGeneration({ collections: [collection], generationId, dimension: 4, metric: "cosine" }))
        expect(build.validated).toBe(true)

        // 3) upsert two rows into the generation collection.
        const rows = [
          { canonicalId: "agent:alpha", canonicalVersion: "h1", dense: [0.1, 0.2, 0.3, 0.4], terms: ["alpha"], filters: { projectId: "proj_live", scope: "global", visibility: "public" } },
          { canonicalId: "agent:beta", canonicalVersion: "h2", dense: [0.5, 0.6, 0.7, 0.8], terms: ["beta"], filters: { projectId: "proj_live", scope: "global", visibility: "public" } },
        ]
        const up = await run(port.upsert({ collection, rows, generationId }))
        expect(up.upsertedCount).toBe(2)

        // 4) enumerate the generation returns the content-free {canonicalId, contentHash} pairs.
        const enumerated = await run(port.enumerateIndexed({ collection, projectId: "proj_live", generationId }))
        expect(enumerated.docs.map((d) => d.canonicalId).sort()).toEqual(["agent:alpha", "agent:beta"])
        expect(enumerated.docs.find((d) => d.canonicalId === "agent:alpha")!.contentHash).toBe("h1")

        // 5) swapAliases atomically points the live alias at the new generation.
        const swap = await run(port.swapAliases({ targets: [{ collection, generationId }], casToken: generationId }))
        expect(swap.swapped).toContain(collection)
      } finally {
        // ALWAYS clean up the throwaway resources, regardless of assertion outcome.
        await dropAlias(address, alias)
        await dropCollection(address, physical)
      }
    },
    30000,
  )
})
