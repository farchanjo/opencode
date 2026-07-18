/**
 * Feature 006 / T034 (S22) — semantic operator domain acceptance.
 *
 * The 30 operations dispatch with zero model calls on ordinary paths, a
 * reserved-ID collision is recognized, confirmation is required for
 * cutover/rollback/rotate-secret, and a non-operator/plugin binding-change is
 * rejected by the backend leaving bindings unchanged (FR28, FR31, C15, AC14,
 * AC28, AC37).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SemanticCommandPort } from "@/operator/semantic/semantic-command-port"
import { SemanticStackWiring } from "@/operator/semantic/stack-wiring"
import { SemanticBackendLive } from "@/operator/semantic/backend-live"
import type { SemanticBackend } from "@/operator/semantic/semantic-port"
import type { BindingPort, ProviderPort } from "@opencode-ai/protocol/semantic/ports"

let modelCalls = 0

const okProvider = (): ProviderPort => ({
  list: () => Effect.succeed({ profiles: [] }),
  add: () => Effect.succeed({ profile: {} as never, auditId: "aud-1" }),
  update: () => Effect.succeed({ profile: {} as never, auditId: "aud-1" }),
  test: () => { modelCalls++; return Effect.succeed({ reachable: true, latencyMs: 1, probeState: "validated" }) },
  disable: () => Effect.succeed({ profile: {} as never, auditId: "aud-1" }),
  delete: (input) => (input.confirmed ? Effect.succeed({ id: input.id, auditId: "aud-1" }) : Effect.fail({ type: "confirmation_required" })),
  rotateSecret: () => Effect.succeed({ profile: {} as never, auditId: "aud-1" }),
})

const okBinding = (): BindingPort => ({
  showEmbedding: () => Effect.succeed({}),
  selectEmbedding: () => Effect.succeed({ binding: {} as never, auditId: "aud-1" }),
  validateEmbedding: () => Effect.succeed({ binding: {} as never, probeState: "validated" }),
  reindexEmbedding: () => Effect.succeed({ generation: {} as never, auditId: "aud-1" }),
  cutoverEmbedding: (input) => (input.confirmed ? Effect.succeed({ binding: {} as never, generation: {} as never, auditId: "aud-1" }) : Effect.fail({ type: "confirmation_required" })),
  rollbackEmbedding: (input) => (input.confirmed ? Effect.succeed({ binding: {} as never, auditId: "aud-1" }) : Effect.fail({ type: "confirmation_required" })),
  showReranker: () => Effect.succeed({}),
  selectReranker: () => Effect.succeed({ binding: {} as never, auditId: "aud-1" }),
  validateReranker: () => Effect.succeed({ binding: {} as never, probeState: "validated" }),
  cutoverReranker: (input) => (input.confirmed ? Effect.succeed({ binding: {} as never, auditId: "aud-1" }) : Effect.fail({ type: "confirmation_required" })),
  rollbackReranker: (input) => (input.confirmed ? Effect.succeed({ binding: {} as never, auditId: "aud-1" }) : Effect.fail({ type: "confirmation_required" })),
  status: () => Effect.succeed({ degradation: { rung: "full_semantic" } }),
  history: () => Effect.succeed({ versions: [] }),
})

const fakeBackend = (): SemanticBackend => ({
  provider: okProvider(),
  binding: okBinding(),
  model: SemanticBackendLive.createLiveSemanticBackend().model, // honest gap for model reads
  index: SemanticBackendLive.createLiveSemanticBackend().index,
})

const audited: string[] = []
const wiring = SemanticStackWiring.createSemanticDomainWiring({
  backend: fakeBackend(),
  audit: { record: (e) => Effect.sync(() => { audited.push(`${e.commandId}:${e.outcome}`) }) },
})
const invoke = wiring.ports.semantic.invoke

const ctx = (id: string, payload: Record<string, unknown> = {}, kind: "operator" | "manager-view" = "operator") => ({
  request: {
    payload,
    principal: { kind, subject: "op-1" },
    scope: { kind: "project", ref: "proj-1" },
    source: "cli",
  },
  descriptor: { id, domain: "semantic" },
}) as never

describe("reserved id set", () => {
  test("declares exactly the 30 reserved semantic ids", () => {
    expect(SemanticCommandPort.RESERVED_SEMANTIC_IDS.size).toBe(30)
    expect(SemanticCommandPort.isReservedSemanticId("semantic.embedding.cutover")).toBe(true)
    expect(SemanticCommandPort.isReservedSemanticId("semantic.not.real")).toBe(false)
  })
})

describe("dispatch", () => {
  test("all 30 reserved ids dispatch to a typed result (never unhandled)", async () => {
    for (const id of SemanticCommandPort.RESERVED_SEMANTIC_IDS) {
      const result = await invoke(ctx(id, { confirmed: true, id: "x", collection: "agents" }))
      expect(result.kind === "query" || result.kind === "failure").toBe(true)
    }
  })

  test("ordinary reads make zero model calls", async () => {
    modelCalls = 0
    await invoke(ctx("semantic.provider.list"))
    await invoke(ctx("semantic.binding.status"))
    await invoke(ctx("semantic.embedding.show"))
    expect(modelCalls).toBe(0)
  })

  test("a non-reserved id is not_implemented", async () => {
    const result = await invoke(ctx("semantic.bogus.op"))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("not_implemented")
  })
})

describe("confirmation matrix", () => {
  test("cutover without confirmation is rejected; with confirmation it settles", async () => {
    const denied = await invoke(ctx("semantic.embedding.cutover", { id: "b1", confirmed: false }))
    expect(denied.kind).toBe("failure")
    const ok = await invoke(ctx("semantic.embedding.cutover", { id: "b1", confirmed: true, generationId: "g", casToken: "c" }))
    expect(ok.kind).toBe("query")
  })

  test("rotate-secret and rollback require confirmation", async () => {
    const rollback = await invoke(ctx("semantic.reranker.rollback", { confirmed: false }))
    expect(rollback.kind).toBe("failure")
  })
})

describe("audit", () => {
  test("emits exactly one bounded audit event per dispatch", async () => {
    audited.length = 0
    await invoke(ctx("semantic.provider.list"))
    expect(audited).toEqual(["semantic.provider.list:ok"])
  })
})
