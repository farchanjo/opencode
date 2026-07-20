/**
 * Feature 019 / T001-T003 (Group A, FR1-FR3) — the config-backed reranker lifecycle
 * dispatched end-to-end through the FULL Feature 007 pipeline (dispatchRequest →
 * confirm → contract → plan → `mutateAuthority`), wired exactly as `stack-live.ts`
 * composes the semantic domain over one shared `store.config` seam.
 *
 * Proves the REAL driven chain with NO injected `validated` state: `select` stages a
 * draft candidate, `validate` runs the wired provider probe and promotes it to
 * validated, `cutover` activates it under CAS + confirmation (bumping the authority
 * version, retaining the prior in the superseded archive), and `rollback` restores the
 * prior — all config-backed with NO Milvus dependency. The honest gates reject + audit
 * and commit nothing: an unvalidated candidate, a failing probe, and an unconfirmed
 * cutover each fail without a phantom write.
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
import type { RerankValidationProbe } from "@/operator/semantic/registry-backend"

const SEMANTIC_AUTHORITY = "semantic"

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

/** A passing (default) / failing rerank probe double the composition threads into the registry. */
const probeThat = (passed: boolean): RerankValidationProbe => ({ run: async () => ({ passed }) })

function harness(opts: { probePasses?: boolean } = {}) {
  const registry = createSeededOperatorCommandRegistry()
  const mp = mutationPorts()
  const audited: string[] = []
  const semantic = SemanticBackendLive.createLiveSemanticBackend({ config: mp.config, rerankProbe: probeThat(opts.probePasses ?? true) })
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
  return { dispatcher, config: mp.config, audited }
}

const dispatch = (
  dispatcher: ReturnType<typeof harness>["dispatcher"],
  id: string,
  payload: Record<string, unknown>,
  opts: { version?: string; interactive?: boolean } = {},
) =>
  dispatcher.dispatchRequest(
    {
      id,
      principal: { kind: "operator", subject: "op_1", projectBinding: "proj_19" },
      scope: { kind: "project", ref: "proj_19" },
      source: "cli",
      payload,
      version: opts.version,
      idempotencyKey: `idem_${id}_${Math.random().toString(36).slice(2)}`,
    } as never,
    { cliInteractiveConfirmed: opts.interactive ?? true },
  )

/** A registered provider + model so `select`/`validate` coherence passes; NO staged candidate. */
const seedDoc = (over: Record<string, unknown> = {}) => ({
  providers: [{
    id: "p1", version: 1, name: "rerank-prov", baseUrl: "https://rerank.local", tlsRequired: true,
    allowInsecureLocalProfile: false, residency: "remote", secretRef: "vault:rr@v1", enabled: true,
    createdAt: "t", updatedAt: "t", selectedBy: "op_1",
  }],
  models: [{
    id: "m_new", providerProfileId: "p1", version: 1, displayName: "rr", endpointMode: "rerank",
    declaredCapabilityKinds: ["rerank"], enabled: true, validationStatus: "declared",
  }],
  embedding: null,
  reranker: null,
  embeddingStaged: null,
  rerankerStaged: null,
  embeddingArchive: [],
  rerankerArchive: [],
  rerankEvalVersion: 0,
  ...over,
})

async function seed(config: ReturnType<typeof harness>["config"], doc: unknown): Promise<string> {
  const res = await config.compareAndSet({ authority: SEMANTIC_AUTHORITY, expectedVersion: null, payload: doc, nowMs: Date.now() })
  if (!res.ok) throw new Error("seed failed")
  return res.version
}

const readReranker = async (dispatcher: ReturnType<typeof harness>["dispatcher"]) => {
  const r = await dispatch(dispatcher, "semantic.binding.history", { slot: "reranker", limit: 20 }, {})
  return (r.effective as { versions: ReadonlyArray<{ bindingVersion: number; state: string; modelDescriptorId: string }> }).versions
}

describe("T001-T003 — the reranker lifecycle dispatches config-backed end-to-end (FR1-FR3)", () => {
  test("select → validate → cutover → rollback drives the real chain with NO injected validated state", async () => {
    const { dispatcher, config } = harness({ probePasses: true })
    // A prior active reranker; the new candidate replaces it through the driven chain.
    let version = await seed(config, seedDoc({
      reranker: { slot: "reranker", modelDescriptorId: "m_old", compatibilityMode: "native-rerank", state: "active", version: 1, selectedBy: "op_1", selectedAt: "t", validated: true },
    }))

    // 1) select — stages a DRAFT candidate (validated:false).
    const sel = await dispatch(dispatcher, "semantic.reranker.select", { modelDescriptorId: "m_new", compatibilityMode: "native-rerank" }, { version })
    expect(sel.ok).toBe(true)
    version = sel.version!

    // 2) validate — runs the wired provider probe and promotes the candidate to validated.
    const val = await dispatch(dispatcher, "semantic.reranker.validate", {}, { version })
    expect(val.ok).toBe(true)
    version = val.version!

    // 3) cutover — activates the now-validated candidate under CAS + confirmation; the version advances.
    const cut = await dispatch(dispatcher, "semantic.reranker.cutover", { confirmed: true }, { version })
    expect(cut.ok).toBe(true)
    expect(cut.version).not.toBe(version)
    version = cut.version!

    let versions = await readReranker(dispatcher)
    const active = versions.find((v) => v.state === "active" && v.modelDescriptorId === "m_new")
    expect(active?.bindingVersion).toBe(2)
    expect(versions.some((v) => v.modelDescriptorId === "m_old")).toBe(true) // prior retained in the archive

    // 4) rollback — restores the archived prior under CAS + confirmation.
    const rb = await dispatch(dispatcher, "semantic.reranker.rollback", { confirmed: true }, { version })
    expect(rb.ok).toBe(true)
    versions = await readReranker(dispatcher)
    expect(versions.find((v) => v.state === "active")?.modelDescriptorId).toBe("m_old")
  })

  test("an unvalidated staged candidate is rejected at cutover, audited, and commits nothing", async () => {
    const { dispatcher, config, audited } = harness()
    // select stages a draft; skip validate → cutover must reject.
    let version = await seed(config, seedDoc())
    const sel = await dispatch(dispatcher, "semantic.reranker.select", { modelDescriptorId: "m_new", compatibilityMode: "native-rerank" }, { version })
    expect(sel.ok).toBe(true)
    version = sel.version!

    const cutover = await dispatch(dispatcher, "semantic.reranker.cutover", { confirmed: true }, { version })
    expect(cutover.ok).toBe(false)
    expect(cutover.error?.message).toContain("not_validated")
    expect(audited).toContain("semantic.reranker.cutover:rejected")

    const versions = await readReranker(dispatcher)
    expect(versions.every((v) => v.state !== "active")).toBe(true) // no phantom write
  })

  test("a FAILING provider probe rejects validate (validation_failed) and never marks the candidate validated", async () => {
    const { dispatcher, config } = harness({ probePasses: false })
    let version = await seed(config, seedDoc())
    const sel = await dispatch(dispatcher, "semantic.reranker.select", { modelDescriptorId: "m_new", compatibilityMode: "native-rerank" }, { version })
    expect(sel.ok).toBe(true)
    version = sel.version!

    // The probe runs in the plan effect; a failure aborts the commit with the typed envelope, no phantom write.
    const val = await dispatch(dispatcher, "semantic.reranker.validate", {}, { version })
    expect(val.ok).toBe(false)
    expect(val.error?.message).toContain("validation_failed")

    // The candidate is still un-validated: a subsequent cutover is rejected not_validated.
    const cut = await dispatch(dispatcher, "semantic.reranker.cutover", { confirmed: true }, { version: val.version ?? version })
    expect(cut.ok).toBe(false)
    expect(cut.error?.message).toContain("not_validated")
  })

  test("an unconfirmed cutover is rejected (confirmation_required), no Milvus involved", async () => {
    const { dispatcher, config } = harness()
    let version = await seed(config, seedDoc())
    const sel = await dispatch(dispatcher, "semantic.reranker.select", { modelDescriptorId: "m_new", compatibilityMode: "native-rerank" }, { version })
    version = sel.version!
    const val = await dispatch(dispatcher, "semantic.reranker.validate", {}, { version })
    version = val.version!
    const cutover = await dispatch(dispatcher, "semantic.reranker.cutover", { confirmed: false }, { version, interactive: false })
    expect(cutover.ok).toBe(false)
  })
})
