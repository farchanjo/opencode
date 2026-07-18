/**
 * Feature 006 / T042 (S25) — Milvus + probe integration matrix.
 *
 * Drives the injected fake Milvus adapter for the pure integration path (HNSW-style
 * dense recall, native sparse hybrid, mandatory scalar filters, cross-project
 * isolation, the typed `milvus_unavailable` gap, upsert/tombstone/reconcile) and,
 * when a standalone Milvus server is present (`MILVUS_ADDRESS`/`MILVUS_PROBE_ADDRESS`),
 * opportunistically records the real gRPC-under-Bun reachability against the
 * container — skipped otherwise. The embedding/rerank probes run against fakes
 * (`/v1/embeddings` dimension/normalization/limits; rerank profile A/B; profile C
 * never reranker-eligible; a manual declaration untrusted until validated)
 * (FR7, FR9, FR30, C1, C6, C7, C16, AC1, AC6, AC7, AC10, AC22, AC23, AC24, AC25, AC26).
 */
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { MilvusAdapter } from "@/semantic/milvus-adapter"
import { IndexJobs } from "@/semantic/index-jobs"
import { EmbeddingClient } from "@/semantic/embedding-client"
import { RerankClient } from "@/semantic/rerank-client"
import { GrpcProbe } from "@/semantic/grpc-probe"

const filters = (projectId: string): MilvusAdapter.MandatoryFilters => ({ projectId, scope: "project", visibility: "public" })
const row = (projectId: string, id: string, dense: number[], terms: string[]): MilvusAdapter.DocumentRow => ({
  canonicalId: id,
  canonicalVersion: "1",
  dense,
  terms,
  filters: filters(projectId),
})
const search = (port: MilvusAdapter.MilvusPort, projectId: string, dense: number[], sparse: string[]) =>
  port.search({ collection: "agents", dense, sparseTerms: sparse, filters: filters(projectId), topK: 10, consistency: "bounded", metric: "cosine" })

describe("T042 fake Milvus adapter — hybrid recall, filters, isolation (AC1, AC6)", () => {
  test("dense+sparse hybrid recall under mandatory filters ranks the relevant doc first", () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    Effect.runSync(port.upsert({ collection: "agents", rows: [row("p1", "a", [1, 0], ["build", "deploy"]), row("p1", "b", [0, 1], ["review"])] }))
    const result = Effect.runSync(search(port, "p1", [1, 0], ["build"]))
    expect(result.hits[0].canonicalId).toBe("a")
    expect(result.hits[0].sparse).toBeGreaterThan(0)
  })

  test("the scalar project key isolates projects (no cross-project leak)", () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    Effect.runSync(port.upsert({ collection: "agents", rows: [row("p1", "a", [1, 0], ["x"]), row("p2", "secret", [1, 0], ["x"])] }))
    expect(Effect.runSync(search(port, "p1", [1, 0], ["x"])).hits.map((h) => h.canonicalId)).toEqual(["a"])
  })

  test("an absent project partition key is rejected (invalid_filters)", () => {
    const port = MilvusAdapter.createFakeMilvusAdapter()
    const exit = Effect.runSyncExit(
      port.search({ collection: "agents", dense: [1, 0], sparseTerms: [], filters: { projectId: "", scope: "project", visibility: "public" }, topK: 10, consistency: "bounded", metric: "cosine" }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("T042 typed milvus_unavailable gap — never a crash (AC7)", () => {
  test("an unbound live gRPC adapter yields milvus_unavailable", () => {
    const exit = Effect.runSyncExit(MilvusAdapter.createGrpcMilvusAdapter().health())
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(JSON.stringify(exit.cause)).toContain("milvus_unavailable")
  })
})

describe("T042 upsert/tombstone/reconcile reflect core state (AC10)", () => {
  const jobFilters = { projectId: "p1", scope: "project", visibility: "public" }
  const liveDoc = (id: string, hash: string): IndexJobs.LiveDoc => ({
    canonicalId: id,
    contentHash: hash,
    row: { canonicalId: id, canonicalVersion: "1", dense: [1, 0], terms: [id], filters: jobFilters },
  })
  const spool: IndexJobs.OutputSpoolSink = { spool: ({ collection, summary }) => Effect.succeed(`output://semantic/${collection}/${summary.upsertedCount}`) }

  test("reconcile upserts new/changed, tombstones removed, spools a ref, keeps the pinned binding", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter()
    const result = await Effect.runPromise(
      IndexJobs.runReconcile({ milvus, spool }, { collection: "agents", live: [liveDoc("a", "h1"), liveDoc("b", "h2")], indexed: [{ canonicalId: "old", contentHash: "hx" }], projectId: "p1", bindingVersion: 7 }),
    )
    expect(result.summary.upsertedCount).toBe(2)
    expect(result.summary.tombstonedCount).toBe(1)
    expect(result.summary.bindingVersion).toBe(7)
    expect(result.outputRef.startsWith("output://")).toBe(true)
  })
})

describe("T042 embedding/rerank probes against fakes (AC22, AC23, AC24, AC25, AC26)", () => {
  const unitVector = (n: number): number[] => {
    const v = new Array(n).fill(0)
    v[0] = 1
    return v
  }

  test("the /v1/embeddings probe captures dimension/normalization and excludes a mismatch", async () => {
    const http: EmbeddingClient.EmbeddingsHttpPort = { postEmbeddings: async (req) => ({ vectors: req.inputs.map(() => unitVector(256)), maxBatchSize: 32 }) }
    const ok = await EmbeddingClient.probe({ http }, { baseUrl: "https://api.example", model: "m" })
    expect(ok.eligible).toBe(true)
    if (ok.eligible) expect(ok.probe.dimension).toBe(256)
    const bad = await EmbeddingClient.probe({ http }, { baseUrl: "https://api.example", model: "m", expectedDimension: 512 })
    expect(bad.eligible).toBe(false)
  })

  test("rerank profile A round-trips; profile C is never reranker-eligible; a name alone is untrusted", async () => {
    const httpA: RerankClient.NativeRerankHttpPort = { postRerank: async () => [{ canonicalId: "b", score: 0.1 }, { canonicalId: "a", score: 0.9 }] }
    const out = await RerankClient.rerankNative({ http: httpA }, { baseUrl: "https://api.example", model: "rr", query: "q", documents: [{ canonicalId: "a", text: "x" }, { canonicalId: "b", text: "y" }], topK: 2 })
    expect(out.ok && out.results[0].canonicalId).toBe("a")
    expect(RerankClient.isRerankerEligible("embedding-similarity")).toBe(false)
    expect(RerankClient.eligibleAfterProbe({ probePassed: false })?.type).toBe("not_validated")
  })
})

const MILVUS_ADDRESS = process.env.MILVUS_ADDRESS ?? process.env.MILVUS_PROBE_ADDRESS
describe("T042 standalone Milvus container (skipped without MILVUS_ADDRESS)", () => {
  test.skipIf(!MILVUS_ADDRESS)("the real gRPC channel reaches a live server under Bun", async () => {
    const finding = await GrpcProbe.runProbe({ sdk: GrpcProbe.liveSdkPort, clock: { nowMs: () => Date.now() } }, { address: MILVUS_ADDRESS!, ssl: false, timeoutMs: 3000 })
    // A present container must surface a supported channel (server reached, or a typed UNAVAILABLE).
    expect(finding.outcome).toBe("grpc_bun_supported")
    expect(GrpcProbe.driverFor(finding)).toBe("grpc")
  }, 15_000)
})
