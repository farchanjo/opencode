/**
 * Feature 006 / T043 (S25) — the fault-injection matrix.
 *
 * Drives three fault matrices through injected ports: the degradation ladder (Milvus
 * down, reranker timeout, embedding down, cold index, no binding → a typed gap code
 * and the catalog/lexical floor, no model substitution, fail-closed opt-in), the
 * cutover fault matrix (select/reindex never activate the alias, cutover CAS success/
 * contention, all collections together, rollback, in-flight version pinning, no vector
 * mixing), and the SSRF/DNS matrix (metadata/link-local/private blocked, non-TLS
 * remote rejected, local-insecure allowance with a warning, post-resolution +
 * post-redirect DNS-rebinding rejection) (FR12, FR24, FR31, FR32, FR33, C12, C17,
 * C20, AC7, AC8, AC9, AC29, AC31, AC32, AC33, AC36, AC38, AC41).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Degradation } from "@opencode-ai/core/semantic/degradation"
import { BindingLifecycle } from "@opencode-ai/core/semantic/binding-lifecycle"
import { CutoverExecutor } from "@/semantic/cutover-executor"
import { MilvusAdapter } from "@/semantic/milvus-adapter"
import { UrlGuard } from "@/semantic/url-guard"

const healthy: Degradation.HealthConditions = {
  no_binding: false,
  milvus_unavailable: false,
  embedding_unavailable: false,
  cold_index: false,
  index_stale: false,
  retrieval_timeout: false,
  reranker_unavailable: false,
}

describe("T043 degradation matrix — typed gap + catalog/lexical floor, no substitution", () => {
  const cases: ReadonlyArray<[keyof Degradation.HealthConditions]> = [
    ["milvus_unavailable"],
    ["reranker_unavailable"],
    ["embedding_unavailable"],
    ["cold_index"],
    ["no_binding"],
    ["retrieval_timeout"],
    ["index_stale"],
  ]

  for (const [fault] of cases) {
    test(`${fault} drops to catalog_lexical with that gap and still yields candidates`, () => {
      const out = Degradation.classify({ ...healthy, [fault]: true })
      expect(out.mode).toBe("catalog_lexical")
      expect(out.gap).toBe(fault)
      expect(Degradation.yieldsCandidates(out.mode)).toBe(true)
    })
  }

  test("fail-closed is only reached on explicit operator opt-in", () => {
    expect(Degradation.classify({ ...healthy, milvus_unavailable: true }, { failClosed: true }).mode).toBe("fail_closed")
    expect(Degradation.classify({ ...healthy, milvus_unavailable: true }).mode).toBe("catalog_lexical")
  })

  test("a bounded retry targets the same pinned binding, then degrades", () => {
    const policy = { maxAttempts: 2 }
    expect(Degradation.nextRetry(0, policy, 5, "retrieval_timeout")).toEqual({ kind: "retry", attempt: 1, binding_version: 5 })
    expect(Degradation.nextRetry(2, policy, 5, "retrieval_timeout")).toEqual({ kind: "degrade", gap: "retrieval_timeout" })
  })

  test("an outage degrades in place without swapping the model ref", () => {
    const snap = BindingLifecycle.step({ state: "active", version: 4, model_ref: "m-embed" }, "outage")
    expect(snap.state).toBe("degraded")
    expect(snap.model_ref).toBe("m-embed")
  })
})

describe("T043 cutover fault matrix — CAS, atomicity, rollback, pinning (AC9, AC31, AC32, AC33, AC41)", () => {
  const ALL: readonly ("agents" | "skills" | "skill_chunks")[] = ["agents", "skills", "skill_chunks"]
  const base = { collections: ALL, fromGeneration: "g1", toGeneration: "g2", bindingVersion: 3 }

  test("select and reindex never activate the alias; only cutover does", () => {
    expect(CutoverExecutor.activatesAlias("select")).toBe(false)
    expect(CutoverExecutor.activatesAlias("reindex")).toBe(false)
    expect(CutoverExecutor.activatesAlias("cutover")).toBe(true)
  })

  test("a matching CAS commits all collections together", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter({ casToken: "cas-1" })
    const outcome = await Effect.runPromise(CutoverExecutor.cutoverEmbedding({ milvus }, { ...base, casExpected: "cas-1", casActual: "cas-1", confirmed: true }))
    expect(outcome.kind).toBe("committed")
    if (outcome.kind === "committed") expect(outcome.swapped).toEqual(ALL)
  })

  test("a CAS contention swaps none", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter()
    const outcome = await Effect.runPromise(CutoverExecutor.cutoverEmbedding({ milvus }, { ...base, casExpected: "cas-1", casActual: "cas-2", confirmed: true }))
    expect(outcome.kind).toBe("cas_conflict")
  })

  test("rollback reverses under confirmation; a reranker cutover re-embeds nothing", async () => {
    const milvus = MilvusAdapter.createFakeMilvusAdapter({ casToken: "cas-9" })
    const rolled = await Effect.runPromise(CutoverExecutor.rollbackEmbedding({ milvus }, { collections: ALL, targetGeneration: "g1", casExpected: "cas-9", casActual: "cas-9", confirmed: true, bindingVersion: 2 }))
    expect(rolled.kind).toBe("committed")
    const rr = CutoverExecutor.cutoverReranker({ confirmed: true, bindingVersion: 5 })
    expect(rr.kind === "committed" && rr.reEmbedded).toBe(false)
  })

  test("a dimension change forces a fresh generation (no vector mixing)", () => {
    expect(CutoverExecutor.requiresReindex({ dimension: 256, metric: "cosine" }, { dimension: 512, metric: "cosine" })).toBe(true)
    expect(CutoverExecutor.requiresReindex({ dimension: 256, metric: "cosine" }, { dimension: 256, metric: "cosine" })).toBe(false)
  })

  test("an in-flight pinned version survives a mid-task operator cutover", () => {
    const pinned = BindingLifecycle.pinForTask({ version: 7, model_ref: "m-embed" })
    expect(BindingLifecycle.resolvePinned(pinned, 8).version).toBe(7)
  })
})

describe("T043 SSRF/DNS matrix — blocked ranges, TLS, rebinding (AC36, AC38)", () => {
  const resolverTo = (map: Record<string, readonly string[]>): UrlGuard.DnsResolver => ({ resolve: async (host) => map[host] ?? ["203.0.113.10"] })
  const REMOTE: UrlGuard.UrlPolicy = { allowInsecureLocalProfile: false }
  const LOCAL: UrlGuard.UrlPolicy = { allowInsecureLocalProfile: true }

  test("metadata/link-local/loopback/private ranges are all blocked", () => {
    for (const ip of ["169.254.169.254", "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "::1", "fe80::1"]) {
      expect(UrlGuard.isBlockedAddress(ip)).toBe(true)
    }
  })

  test("a host resolving to metadata is ssrf_blocked; a non-TLS remote is tls_required", async () => {
    const meta = await UrlGuard.guard({ resolver: resolverTo({ "evil.example": ["169.254.169.254"] }) }, { rawUrl: "https://evil.example/v1", policy: REMOTE })
    expect(meta.ok === false && meta.reason.type).toBe("ssrf_blocked")
    const plain = await UrlGuard.guard({ resolver: resolverTo({}) }, { rawUrl: "http://api.example/v1", policy: REMOTE })
    expect(plain.ok === false && plain.reason.type).toBe("tls_required")
  })

  test("an explicit local-insecure profile is allowed with a warning", async () => {
    const local = await UrlGuard.guard({ resolver: resolverTo({ localhost: ["127.0.0.1"] }) }, { rawUrl: "http://localhost:19530/v1", policy: LOCAL })
    expect(local.ok).toBe(true)
    if (local.ok) expect(local.warnings.length).toBeGreaterThan(0)
  })

  test("a post-redirect rebind to a private IP is rejected", async () => {
    const rebind = await UrlGuard.guardRedirect({ resolver: resolverTo({ "rebind.example": ["10.0.0.5"] }) }, { redirectLocation: "https://rebind.example/internal", policy: REMOTE })
    expect(rebind.ok === false && rebind.reason.type).toBe("ssrf_blocked")
  })
})
