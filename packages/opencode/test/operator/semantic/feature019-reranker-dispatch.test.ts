/**
 * Feature 019 / T001-T003 (Group A, FR1-FR3) — the config-backed reranker cutover
 * dispatched end-to-end through the FULL Feature 007 pipeline (dispatchRequest →
 * confirm → contract → plan → `mutateAuthority`), wired exactly as `stack-live.ts`
 * composes the semantic domain over one shared `store.config` seam.
 *
 * Proves: a validated staged reranker candidate cuts over under CAS + confirmation,
 * bumps the authority version, and re-reads as `active` with the prior retained in the
 * superseded archive — with NO Milvus dependency (the reranker path is config-backed).
 * An unvalidated candidate is honestly rejected and audited, committing nothing.
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

function harness() {
  const registry = createSeededOperatorCommandRegistry()
  const mp = mutationPorts()
  const audited: string[] = []
  const semantic = SemanticBackendLive.createLiveSemanticBackend({ config: mp.config })
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

/** A validated staged reranker candidate seeded directly into the `semantic` authority document. */
const seedDoc = (over: Record<string, unknown> = {}) => ({
  providers: [],
  models: [],
  embedding: null,
  reranker: null,
  embeddingStaged: null,
  rerankerStaged: {
    slot: "reranker",
    modelDescriptorId: "m_new",
    compatibilityMode: "native-rerank",
    state: "staged",
    version: 2,
    selectedBy: "op_1",
    selectedAt: "2026-01-01T00:00:00.000Z",
    validated: true,
  },
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

describe("T001-T003 — reranker cutover dispatches config-backed end-to-end (FR1-FR3)", () => {
  test("a validated staged candidate cuts over under CAS + confirmation, bumps the version, and re-reads active", async () => {
    const { dispatcher, config } = harness()
    // seed a prior active reranker + a validated staged candidate replacing it
    const version = await seed(config, seedDoc({
      reranker: { slot: "reranker", modelDescriptorId: "m_old", compatibilityMode: "native-rerank", state: "active", version: 1, selectedBy: "op_1", selectedAt: "t", validated: true },
    }))

    const cutover = await dispatch(dispatcher, "semantic.reranker.cutover", { confirmed: true }, { version })
    expect(cutover.ok).toBe(true)
    expect(cutover.version).not.toBe(version) // the authority CAS version advanced (audited commit)

    const versions = await readReranker(dispatcher)
    // the staged candidate is now the active reranker; the prior is retained as a superseded archive entry
    const active = versions.find((v) => v.state === "active" && v.modelDescriptorId === "m_new")
    expect(active?.bindingVersion).toBe(2)
    expect(versions.some((v) => v.modelDescriptorId === "m_old")).toBe(true)
  })

  test("an unvalidated candidate is rejected, audited, and commits nothing", async () => {
    const { dispatcher, config, audited } = harness()
    const version = await seed(config, seedDoc({
      rerankerStaged: { slot: "reranker", modelDescriptorId: "m_new", compatibilityMode: "native-rerank", state: "staged", version: 2, selectedBy: "op_1", selectedAt: "t", validated: false },
    }))

    const cutover = await dispatch(dispatcher, "semantic.reranker.cutover", { confirmed: true }, { version })
    expect(cutover.ok).toBe(false)
    expect(cutover.error?.message).toContain("not_validated")
    expect(audited).toContain("semantic.reranker.cutover:rejected")

    // no phantom write: the staged candidate is still staged, no active reranker
    const versions = await readReranker(dispatcher)
    expect(versions.every((v) => v.state !== "active")).toBe(true)
  })

  test("an unconfirmed cutover is rejected (confirmation_required), no Milvus involved", async () => {
    const { dispatcher, config } = harness()
    const version = await seed(config, seedDoc())
    const cutover = await dispatch(dispatcher, "semantic.reranker.cutover", { confirmed: false }, { version, interactive: false })
    expect(cutover.ok).toBe(false)
  })
})
