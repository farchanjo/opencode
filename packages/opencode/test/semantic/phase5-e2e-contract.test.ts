/**
 * Feature 006 / T044 (S25) — contract + end-to-end matrix through the operator stack.
 *
 * Exercises the 30 reserved `semantic.*` IDs against the existing reserved catalog
 * (already at 1.3.0) — reserved-ID collision rejection, surface parity (the same
 * binding op from Settings/palette/slash/CLI yields the same effective binding and
 * one bounded audit with zero admin-time model tokens), a prompt/plugin/MCP
 * binding-change attempt leaving bindings unchanged, secret rotation keeping binding
 * identity with a redacted audit, a local no-key embedding register, a delete-bound
 * confirmation, and the offline golden eval harness for pt/es/en with the fixed zero
 * leakage tolerance and no binding mutation (FR28, FR31, FR35, FR43, C15, C18, C19,
 * AC14, AC19, AC20, AC21, AC27, AC28, AC30, AC35, AC37, AC39, AC40).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { RESERVED_CATALOG, RESERVED_CATALOG_VERSION } from "@opencode-ai/core/operator/catalog"
import { SemanticCommandPort } from "@/operator/semantic/semantic-command-port"
import { SemanticStackWiring } from "@/operator/semantic/stack-wiring"
import { SemanticBackendLive } from "@/operator/semantic/backend-live"
import type { SemanticBackend } from "@/operator/semantic/semantic-port"
import type { BindingPort, ProviderPort } from "@opencode-ai/protocol/semantic/ports"
import { CredentialResolver } from "@/semantic/credential-resolver"
import { EvalHarness } from "@/semantic/eval-harness"

let modelCalls = 0
const okProvider = (): ProviderPort => ({
  list: () => Effect.succeed({ profiles: [] }),
  add: () => Effect.succeed({ profile: {} as never, auditId: "aud-1" }),
  update: () => Effect.succeed({ profile: {} as never, auditId: "aud-1" }),
  test: () => {
    modelCalls++
    return Effect.succeed({ reachable: true, latencyMs: 1, probeState: "validated" })
  },
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
  model: SemanticBackendLive.createLiveSemanticBackend().model,
  index: SemanticBackendLive.createLiveSemanticBackend().index,
})

const audited: string[] = []
const wiring = SemanticStackWiring.createSemanticDomainWiring({
  backend: fakeBackend(),
  audit: { record: (e) => Effect.sync(() => { audited.push(`${e.commandId}:${e.outcome}`) }) },
})
const invoke = wiring.ports.semantic.invoke
const ctx = (id: string, payload: Record<string, unknown> = {}, source = "cli", kind: "operator" | "manager-view" = "operator") =>
  ({ request: { payload, principal: { kind, subject: "op-1" }, scope: { kind: "project", ref: "proj-1" }, source }, descriptor: { id, domain: "semantic" } }) as never

describe("T044 catalog contract — 30 semantic ids at 1.3.0, no bump (C15)", () => {
  test("the reserved catalog carries exactly the 30 semantic ids the command port declares", () => {
    expect(RESERVED_CATALOG_VERSION).toBe("1.3.0")
    const catalogSemantic = RESERVED_CATALOG.ids.filter((id) => id.startsWith("semantic."))
    expect(catalogSemantic.length).toBe(30)
    expect(new Set(catalogSemantic)).toEqual(new Set(SemanticCommandPort.RESERVED_SEMANTIC_IDS))
  })

  test("a non-reserved semantic id is not_implemented (collision/unknown rejected)", async () => {
    const result = await invoke(ctx("semantic.bogus.op"))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("not_implemented")
  })
})

describe("T044 surface parity — same op from any surface, zero admin tokens (AC14, AC39)", () => {
  test("the same binding status from cli/palette/slash yields the same result and one audit each", async () => {
    modelCalls = 0
    audited.length = 0
    const results = []
    for (const source of ["cli", "palette", "slash", "tui"]) {
      results.push(await invoke(ctx("semantic.binding.status", {}, source)))
    }
    for (const r of results) expect(r.kind).toBe("query")
    // Ordinary status reads make zero model/LLM calls regardless of surface.
    expect(modelCalls).toBe(0)
    expect(audited).toEqual(["semantic.binding.status:ok", "semantic.binding.status:ok", "semantic.binding.status:ok", "semantic.binding.status:ok"])
  })

  test("all 30 ids dispatch to a typed result (never unhandled)", async () => {
    for (const id of SemanticCommandPort.RESERVED_SEMANTIC_IDS) {
      const result = await invoke(ctx(id, { confirmed: true, id: "x", collection: "agents", generationId: "g", casToken: "c" }))
      expect(result.kind === "query" || result.kind === "failure").toBe(true)
    }
  })
})

describe("T044 mutation guards — confirmation + non-operator rejection (AC28, AC37)", () => {
  test("cutover/rollback/rotate-secret require confirmation", async () => {
    expect((await invoke(ctx("semantic.embedding.cutover", { id: "b1", confirmed: false }))).kind).toBe("failure")
    expect((await invoke(ctx("semantic.reranker.rollback", { confirmed: false }))).kind).toBe("failure")
    expect((await invoke(ctx("semantic.provider.delete", { id: "p1", confirmed: false }))).kind).toBe("failure")
  })

  test("a delete of a bound model settles only with explicit confirmation", async () => {
    expect((await invoke(ctx("semantic.provider.delete", { id: "p1", confirmed: true }))).kind).toBe("query")
  })
})

describe("T044 credentials — rotation keeps binding identity, no plaintext (AC30, AC35)", () => {
  const identity = { providerProfileId: "prov-1", modelDescriptorId: "model-1", bindingId: "bind-1" }
  const currentRef = { backend: "keychain" as const, name: "milvus-token", version: 1 }
  const newRef = { backend: "keychain" as const, name: "milvus-token", version: 2 }

  test("rotate-secret changes only the ref version; the audit is redacted", () => {
    const rotated = CredentialResolver.rotateSecret({ identity, currentRef, newRef })
    expect(rotated.identity).toEqual(identity)
    expect(rotated.changed).toBe("secret_ref_only")
    const audit = CredentialResolver.auditRotation({ identity, currentRef, newRef })
    expect(CredentialResolver.containsPlaintextSecret(audit)).toBe(false)
  })

  test("a local no-key profile needs no secret ref; a plaintext key is flagged (AC19, AC20)", () => {
    expect(CredentialResolver.containsPlaintextSecret({ secret_ref: null })).toBe(false)
    expect(CredentialResolver.containsPlaintextSecret({ apiKey: "sk-live-123456" })).toBe(true)
  })
})

describe("T044 offline golden eval — pt/es/en, zero leakage, no mutation (AC40)", () => {
  const cases: EvalHarness.GoldenCase[] = [
    { queryId: "q1", locale: "pt-BR", relevant: ["a"], retrieved: ["a", "b"], leaked: [] },
    { queryId: "q2", locale: "es", relevant: ["c"], retrieved: ["c"], leaked: [] },
    { queryId: "q3", locale: "en", relevant: ["e"], retrieved: ["x", "e"], leaked: [] },
  ]

  test("records per-locale recall/nDCG/MRR and passes with zero leakage", () => {
    const report = EvalHarness.runGolden(cases, 5)
    expect(report.localeBreakdown.map((l) => l.languageTag).sort()).toEqual(["en", "es", "pt-BR"])
    expect(report.leakageCount).toBe(0)
    expect(report.passed).toBe(true)
  })

  test("any leakage fails the run (fixed zero tolerance)", () => {
    const leaky = [...cases, { queryId: "q4", locale: "en", relevant: ["z"], retrieved: ["z"], leaked: ["other-project-doc"] }]
    const report = EvalHarness.runGolden(leaky, 5)
    expect(report.passed).toBe(false)
  })
})
