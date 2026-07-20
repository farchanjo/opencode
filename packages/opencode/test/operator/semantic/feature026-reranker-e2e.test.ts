/**
 * Feature 026 / T001-T005 — the operator RERANKER binding lifecycle, driven END-TO-END
 * through the FULL Feature 007 pipeline (dispatchRequest → confirm → contract → plan →
 * `mutateAuthority`), wired exactly as `stack-live.ts` composes the semantic domain over one
 * shared `store.config` seam, with a REAL reranker validation probe over a FAKE rerank HTTP
 * transport (NO network, NO Milvus, NO injected staged state).
 *
 * Proves the whole chain from an EMPTY registry: `provider.add` → `model.register` →
 * `reranker.select` → `reranker.validate` (the real probe runs against the fake transport and
 * promotes BOTH the staged binding AND the model descriptor to `validated`) → `reranker.cutover`
 * → `reranker.rollback`, asserting each persists under CAS, the archive grows, and the rollback
 * restores the prior. It also proves the FLAT model descriptor renders (no nested shape, so the
 * TUI `isModelDescriptor` guard accepts it), a validated reranker model becomes an eligible
 * selector candidate, a failing probe rejects `validation_failed` (nothing committed), and the
 * resolved secret NEVER appears in any result/audit line.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  createDispatcher,
  createSeededOperatorCommandRegistry,
  createProcessMutexLockPort,
  type MutationPorts,
} from "@/operator/application"
import { createFakeConfigService, createMemoryEventPort, createMemoryOutboxPort } from "@/operator/adapters"
import { createDurableOperatorStore } from "@/operator/adapters/outbound/config-service"
import { handlersFromDomainPorts, domainHandlerFor, wireDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import type { DomainPorts } from "@/operator/application/ports/domain-ports"
import { SemanticStackWiring } from "@/operator/semantic/stack-wiring"
import { SemanticBackendLive } from "@/operator/semantic/backend-live"
import { RerankProbe } from "@/operator/semantic/rerank-probe"

const SECRET_MATERIAL = "super-secret-rerank-token-DO-NOT-LEAK"

function mutationPorts(): MutationPorts {
  const lock = createProcessMutexLockPort()
  const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
  return {
    config: store.config,
    idempotency: store.idempotency,
    rollback: store.rollback,
    events: createMemoryEventPort(),
    requireAudit: false,
    outbox: createMemoryOutboxPort(),
  }
}

/**
 * A FAKE rerank HTTP transport: records every call (url + resolved auth header) so the test can
 * assert the secret is used but never leaked, and returns a canned native `/v1/rerank` body with
 * (`passing`) or without (`!passing`) scored rows.
 */
function fakeHttp(passing: boolean) {
  const calls: Array<{ url: string; authHeader: string | null }> = []
  const http: RerankProbe.RerankProbeHttpClient = {
    postJson: async ({ url, authHeader }) => {
      calls.push({ url, authHeader })
      return passing ? { results: [{ index: 0, relevance_score: 0.91 }, { index: 1, relevance_score: 0.07 }] } : { results: [] }
    },
  }
  return { http, calls }
}

function harness(opts: { probePasses?: boolean } = {}) {
  const { http, calls } = fakeHttp(opts.probePasses ?? true)
  const rerankProbe = RerankProbe.createRerankValidationProbe({
    http,
    resolveAuthHeader: async (secretRef) => (secretRef.length > 0 ? `Bearer ${SECRET_MATERIAL}` : null),
  })
  const registry = createSeededOperatorCommandRegistry()
  const mp = mutationPorts()
  const audited: string[] = []
  const semantic = SemanticBackendLive.createLiveSemanticBackend({ config: mp.config, rerankProbe })
  const domainPorts: DomainPorts = wireDomainPorts({
    ...SemanticStackWiring.createSemanticDomainWiring({
      backend: semantic,
      audit: { record: (e) => Effect.sync(() => { audited.push(`${e.commandId}:${e.outcome}`) }) },
    }).ports,
  })
  const dispatcher = createDispatcher({
    registry,
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config: mp.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
  return { dispatcher, config: mp.config, audited, httpCalls: calls }
}

const dispatch = (
  dispatcher: ReturnType<typeof harness>["dispatcher"],
  id: string,
  payload: Record<string, unknown>,
  opts: { version?: string } = {},
) =>
  dispatcher.dispatchRequest(
    {
      id,
      principal: { kind: "operator", subject: "op_26", projectBinding: "proj_26" },
      scope: { kind: "project", ref: "proj_26" },
      source: "cli",
      payload,
      version: opts.version,
      idempotencyKey: `idem_${id}_${Math.random().toString(36).slice(2)}`,
    } as never,
    { cliInteractiveConfirmed: true },
  )

type Descriptor = {
  id: string
  providerProfileId: string
  modelRef: string
  displayName: string
  capabilityKinds: readonly string[]
  probeState: string
  enabled: boolean
}

const listModels = async (dispatcher: ReturnType<typeof harness>["dispatcher"]): Promise<readonly Descriptor[]> => {
  const r = await dispatch(dispatcher, "semantic.model.list", {})
  return (r.effective as { descriptors: readonly Descriptor[] }).descriptors
}
const listProviders = async (dispatcher: ReturnType<typeof harness>["dispatcher"]) => {
  const r = await dispatch(dispatcher, "semantic.provider.list", {})
  return (r.effective as { profiles: ReadonlyArray<{ id: string }> }).profiles
}
const readReranker = async (dispatcher: ReturnType<typeof harness>["dispatcher"]) => {
  const r = await dispatch(dispatcher, "semantic.binding.history", { slot: "reranker", limit: 20 })
  return (r.effective as { versions: ReadonlyArray<{ bindingVersion: number; state: string; modelDescriptorId: string }> }).versions
}

/** Register a provider and return the current CAS version + the generated provider id. */
async function addProvider(dispatcher: ReturnType<typeof harness>["dispatcher"]) {
  const add = await dispatch(dispatcher, "semantic.provider.add", {
    name: "rerank-prov", baseUrl: "https://rerank.local", tlsRequired: true, residency: "remote", secretRef: "keychain:rr@v1",
  })
  expect(add.ok).toBe(true)
  const providers = await listProviders(dispatcher)
  expect(providers).toHaveLength(1)
  return { version: add.version!, providerId: providers[0]!.id }
}

/** Register a reranker-capable model and return its generated descriptor id + the CAS version. */
async function registerModel(
  dispatcher: ReturnType<typeof harness>["dispatcher"],
  providerId: string,
  version: string,
  over: { displayName: string; modelRef: string },
) {
  const reg = await dispatch(dispatcher, "semantic.model.register", {
    providerProfileId: providerId, modelRef: over.modelRef, displayName: over.displayName,
    endpointMode: "rerank", declaredCapabilityKinds: ["reranker"],
  }, { version })
  expect(reg.ok).toBe(true)
  const models = await listModels(dispatcher)
  const model = models.find((m) => m.displayName === over.displayName)!
  return { version: reg.version!, modelId: model.id }
}

/** Drive select → validate → cutover for one model; returns the advanced CAS version. */
async function bindReranker(dispatcher: ReturnType<typeof harness>["dispatcher"], modelId: string, version: string) {
  const sel = await dispatch(dispatcher, "semantic.reranker.select", { modelDescriptorId: modelId, compatibilityMode: "native-rerank" }, { version })
  expect(sel.ok).toBe(true)
  const val = await dispatch(dispatcher, "semantic.reranker.validate", {}, { version: sel.version! })
  expect(val.ok).toBe(true)
  const cut = await dispatch(dispatcher, "semantic.reranker.cutover", { confirmed: true }, { version: val.version! })
  expect(cut.ok).toBe(true)
  expect(cut.version).not.toBe(val.version)
  return cut.version!
}

describe("T004-T005 — the reranker lifecycle drives config-backed end-to-end from an EMPTY registry (FR2-FR5)", () => {
  test("provider.add → model.register → select → validate → cutover → rollback, no injected state", async () => {
    const { dispatcher } = harness({ probePasses: true })

    // provider.add + two reranker models, all through the real dispatcher (no seed).
    const { version: v0, providerId } = await addProvider(dispatcher)
    const a = await registerModel(dispatcher, providerId, v0, { displayName: "reranker-A", modelRef: "rerank-model-a" })
    const b = await registerModel(dispatcher, providerId, a.version, { displayName: "reranker-B", modelRef: "rerank-model-b" })

    // FLAT descriptor render (FR3): every model projects the flat protocol shape, declared until validated.
    const declared = await listModels(dispatcher)
    expect(declared).toHaveLength(2)
    for (const d of declared) {
      expect(typeof d.displayName).toBe("string")
      expect(Array.isArray(d.capabilityKinds)).toBe(true)
      expect(d.capabilityKinds).toContain("reranker")
      expect(d.probeState).toBe("declared")
      expect(d.enabled).toBe(true)
      // No nested legacy shape leaked through.
      expect((d as Record<string, unknown>).identity).toBeUndefined()
      expect((d as Record<string, unknown>).capability).toBeUndefined()
      expect((d as Record<string, unknown>).validation).toBeUndefined()
    }

    // Bind A through the driven chain; validate promotes A (binding + model) to validated.
    const vA = await bindReranker(dispatcher, a.modelId, b.version)
    const afterA = await listModels(dispatcher)
    expect(afterA.find((m) => m.id === a.modelId)!.probeState).toBe("validated") // FR4 eligibility
    expect(afterA.find((m) => m.id === b.modelId)!.probeState).toBe("declared")

    // Bind B; its cutover archives the outgoing active A (the archive grows).
    const vB = await bindReranker(dispatcher, b.modelId, vA)
    let versions = await readReranker(dispatcher)
    expect(versions.find((v) => v.state === "active")!.modelDescriptorId).toBe(b.modelId)
    expect(versions.some((v) => v.modelDescriptorId === a.modelId)).toBe(true) // prior A retained in the archive

    // rollback restores the archived prior A under CAS + confirmation.
    const rb = await dispatch(dispatcher, "semantic.reranker.rollback", { confirmed: true }, { version: vB })
    expect(rb.ok).toBe(true)
    versions = await readReranker(dispatcher)
    expect(versions.find((v) => v.state === "active")!.modelDescriptorId).toBe(a.modelId)
  })

  test("a validated reranker model is an eligible selector candidate; a declared one is not (FR3, FR4)", async () => {
    const { dispatcher } = harness({ probePasses: true })
    const { version: v0, providerId } = await addProvider(dispatcher)
    const a = await registerModel(dispatcher, providerId, v0, { displayName: "reranker-A", modelRef: "rerank-model-a" })

    // Before validate: declared → not yet an eligible reranker candidate.
    const before = await listModels(dispatcher)
    expect(before.find((m) => m.id === a.modelId)!.probeState).toBe("declared")

    // select + validate promotes it to validated.
    const sel = await dispatch(dispatcher, "semantic.reranker.select", { modelDescriptorId: a.modelId, compatibilityMode: "native-rerank" }, { version: a.version })
    const val = await dispatch(dispatcher, "semantic.reranker.validate", {}, { version: sel.version! })
    expect(val.ok).toBe(true)

    // The reranker selector eligibility predicate (enabled && validated && capability reranker) now holds.
    const after = await listModels(dispatcher)
    const d = after.find((m) => m.id === a.modelId)!
    const eligible = d.enabled && d.probeState === "validated" && d.capabilityKinds.includes("reranker")
    expect(eligible).toBe(true)
  })
})

describe("T004 — honest probe negatives: nothing committed, secret never leaks (FR5)", () => {
  test("a FAILING provider probe rejects validate (validation_failed) and never marks validated", async () => {
    const { dispatcher } = harness({ probePasses: false })
    const { version: v0, providerId } = await addProvider(dispatcher)
    const a = await registerModel(dispatcher, providerId, v0, { displayName: "reranker-A", modelRef: "rerank-model-a" })
    const sel = await dispatch(dispatcher, "semantic.reranker.select", { modelDescriptorId: a.modelId, compatibilityMode: "native-rerank" }, { version: a.version })

    const val = await dispatch(dispatcher, "semantic.reranker.validate", {}, { version: sel.version! })
    expect(val.ok).toBe(false)
    expect(val.error?.message).toContain("validation_failed")

    // The model is still declared, and a subsequent cutover is rejected not_validated (no phantom write).
    expect((await listModels(dispatcher)).find((m) => m.id === a.modelId)!.probeState).toBe("declared")
    const cut = await dispatch(dispatcher, "semantic.reranker.cutover", { confirmed: true }, { version: val.version ?? sel.version! })
    expect(cut.ok).toBe(false)
    expect(cut.error?.message).toContain("not_validated")
  })

  test("the resolved secret is used for the probe call but NEVER appears in any result or audit line", async () => {
    const { dispatcher, audited, httpCalls } = harness({ probePasses: true })
    const { version: v0, providerId } = await addProvider(dispatcher)
    const a = await registerModel(dispatcher, providerId, v0, { displayName: "reranker-A", modelRef: "rerank-model-a" })
    const sel = await dispatch(dispatcher, "semantic.reranker.select", { modelDescriptorId: a.modelId, compatibilityMode: "native-rerank" }, { version: a.version })
    const val = await dispatch(dispatcher, "semantic.reranker.validate", {}, { version: sel.version! })

    // The probe transport DID receive the resolved Authorization header (the secret is used, not dropped).
    expect(httpCalls.some((c) => c.authHeader === `Bearer ${SECRET_MATERIAL}`)).toBe(true)
    // …but the secret material never crosses the result seam or the audit trail.
    expect(JSON.stringify(val)).not.toContain(SECRET_MATERIAL)
    expect(audited.join("|")).not.toContain(SECRET_MATERIAL)
    expect(JSON.stringify(await listModels(dispatcher))).not.toContain(SECRET_MATERIAL)
  })
})
