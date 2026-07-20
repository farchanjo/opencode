/**
 * Feature 011 T015 — form payload dispatch + honest-unavailable rendering.
 * Drives the real `executeOperatorCommand` path (the same one the grouped menu,
 * the Configure form, and the langlock settings picker all call) through a spy
 * `OperatorSlashPort`, asserting the collected payload reaches the wire and that
 * an honest-unavailable verb surfaces the typed envelope with no synthesized
 * success (FR5, FR7, FR8).
 */
import { describe, expect, test } from "bun:test"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import { executeOperatorCommand } from "../../src/operator/execute"
import { resolveOperatorFormField } from "../../src/operator/form"
import { createSpyPort, createFakeToast, createFakeDialog, spyDisplay } from "./harness"

const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
function entry(id: string): OperatorPaletteEntry {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`missing entry ${id}`)
  return e
}

describe("T015 form payload dispatch (FR5, FR8)", () => {
  test("value_picker form collects a value → dispatched as JSON payload on the same command id", async () => {
    const langlockSet = entry("langlock.set")
    const field = resolveOperatorFormField(langlockSet)
    expect(field?.mode).toBe("value_picker")
    if (!field || field.mode !== "value_picker") throw new Error("expected value_picker field")

    const option = field.options()[0]
    expect(option).toBeDefined()
    // Mirror OperatorForm.dispatchPayload: payload is a single { [field.key]: value }.
    const payload = { [field.key]: option.value }

    const spy = createSpyPort()
    const { toast } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: langlockSet,
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      payload,
    })

    expect(result.outcome).toBe("success")
    expect(spy.tryHandleCalls).toHaveLength(1)
    expect(spy.preflightCalls).toHaveLength(1)
    const sent = spy.tryHandleCalls[0].text
    expect(sent).toBe(`/op.langlock.set ${JSON.stringify(payload)}`)
    expect(JSON.parse(sent.slice(sent.indexOf(" ") + 1))).toEqual({ tag: option.value })
    // form-collected verbs mint an idempotency key + preflight (no blind mutate)
    expect(spy.tryHandleCalls[0].idempotencyKey).toBeString()
  })

  test("text_input form value is carried under the descriptor's key", async () => {
    const jobsCreate = entry("jobs.create")
    const field = resolveOperatorFormField(jobsCreate)
    expect(field?.mode).toBe("text_input")
    if (!field || field.mode !== "text_input") throw new Error("expected text_input field")

    const validation = field.validate("{\"name\":\"nightly\"}")
    expect(validation.ok).toBe(true)
    if (!validation.ok) throw new Error("expected valid text")

    const spy = createSpyPort()
    const { toast } = createFakeToast()
    await executeOperatorCommand({
      entry: jobsCreate,
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      payload: field.toPayload(validation.value),
    })

    const sent = spy.tryHandleCalls[0].text
    expect(sent.startsWith("/op.jobs.create ")).toBe(true)
    expect(JSON.parse(sent.slice(sent.indexOf(" ") + 1))).toEqual({ definition: "{\"name\":\"nightly\"}" })
  })

  test("text_input rejects empty input before any dispatch (no wire call)", () => {
    const field = resolveOperatorFormField(entry("routing.configure"))
    if (!field || field.mode !== "text_input") throw new Error("expected text_input field")
    const validation = field.validate("   ")
    expect(validation.ok).toBe(false)
  })
})

describe("Feature 014 — Configure form payload matches the port contract (FR12, FR14)", () => {
  /** Resolve a text_input field's built payload for `value`, failing loudly on a resolve/validate miss. */
  function builtPayload(id: string, value: string): Record<string, unknown> {
    const field = resolveOperatorFormField(entry(id))
    if (!field || field.mode !== "text_input") throw new Error(`expected text_input field for ${id}`)
    const validation = field.validate(value)
    if (!validation.ok) throw new Error(`unexpected invalid ${id}: ${validation.message}`)
    return field.toPayload(validation.value)
  }

  test("scalar registry verbs carry the port's canonical key, not a wrapper key", () => {
    // The semantic command port reads top-level `id` / `newSecretRef` /
    // `modelDescriptorId`; the pre-fix wrapper keys (`providerId`/`modelId`/
    // `secretRef`) reached the port as "" → not_found / not_validated.
    expect(builtPayload("semantic.provider.disable", "prov_123")).toEqual({ id: "prov_123" })
    expect(builtPayload("semantic.provider.delete", "prov_123")).toEqual({ id: "prov_123" })
    // semantic.model.disable now resolves the shared connected-models picker (Feature
    // 020 FR3), but composes the SAME canonical { id } payload — contract unchanged (FR5).
    const disable = resolveOperatorFormField(entry("semantic.model.disable"))
    if (disable?.mode !== "model_picker") throw new Error("expected model_picker field for semantic.model.disable")
    expect(disable.toPayload("model_123")).toEqual({ id: "model_123" })
    expect(builtPayload("semantic.embedding.select", "model_123")).toEqual({ modelDescriptorId: "model_123" })
    expect(builtPayload("semantic.reranker.select", "model_123")).toEqual({ modelDescriptorId: "model_123" })
    expect(builtPayload("semantic.provider.rotate-secret", "keychain:k@v2")).toEqual({ newSecretRef: "keychain:k@v2" })
  })

  test("JSON registry/policy verbs spread their object to the top level, not under a wrapper key", () => {
    // The ports read top-level fields (`name`/`baseUrl`, `ttlSeconds`, `quotaScope`);
    // the pre-fix `{ provider: "…json…" }` / `{ policy: "…json…" }` wrapper dropped
    // the operator input and persisted a default (a false success).
    expect(builtPayload("semantic.provider.add", '{"name":"vec","baseUrl":"https://v.example","secretRef":"keychain:k@v1"}')).toEqual({
      name: "vec",
      baseUrl: "https://v.example",
      secretRef: "keychain:k@v1",
    })
    expect(builtPayload("output.retention.set", '{"ttlSeconds":86400,"legalHold":false}')).toEqual({
      ttlSeconds: 86400,
      legalHold: false,
    })
    expect(builtPayload("output.quota.set", '{"quotaScope":"session","maxBytes":1048576}')).toEqual({
      quotaScope: "session",
      maxBytes: 1048576,
    })
  })

  test("a JSON field rejects malformed / non-object input before any dispatch", () => {
    const field = resolveOperatorFormField(entry("semantic.provider.add"))
    if (!field || field.mode !== "text_input") throw new Error("expected text_input field")
    expect(field.validate("not json").ok).toBe(false)
    expect(field.validate("[1,2,3]").ok).toBe(false)
    expect(field.validate('"scalar"').ok).toBe(false)
    expect(field.validate('{"name":"ok"}').ok).toBe(true)
  })
})

describe("T015 honest-unavailable rendering (FR7)", () => {
  test("an unavailable verb surfaces the typed envelope; no synthesized success", async () => {
    // Feature 014 T012: semantic.provider.add now persists; the Milvus-gated index
    // verb is the representative honest-unavailable mutation.
    const reindex = entry("semantic.index.reindex")
    expect(reindex.availability).toBe("unavailable")
    expect(reindex.persistence).toBe("honest_unavailable")
    // The verb has no form → the menu dispatches directly (T012); the backend
    // answers with the typed not-implemented envelope.
    expect(resolveOperatorFormField(reindex)).toBeUndefined()

    const spy = createSpyPort(() =>
      spyDisplay({
        title: "Not implemented",
        message: "semantic.index.reindex is not implemented yet",
        variant: "warning",
        outcome: "not_implemented",
      }),
    )
    const { toast, calls } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: reindex,
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
    })

    // Same canonical command id dispatched (no divergent path), envelope surfaced verbatim.
    expect(spy.tryHandleCalls[0].text).toBe("/op.semantic.index.reindex")
    expect(result.outcome).toBe("not_implemented")
    expect(calls).toHaveLength(1)
    expect(calls[0].variant).not.toBe("success")
    expect(calls[0].variant).toBe("warning")
    expect(calls[0].message).toContain("not implemented")
  })

  test("a secret mutation is refused before any dispatch (no plaintext on the wire)", async () => {
    const secret = entry("mcp.auth.start")
    expect(secret.secretRelated).toBe(true)
    expect(secret.executable).toBe(false)

    const spy = createSpyPort()
    const { toast, calls } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: secret,
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
    })

    expect(result.outcome).toBe("unavailable")
    expect(spy.tryHandleCalls).toHaveLength(0)
    expect(spy.preflightCalls).toHaveLength(0)
    expect(calls[0].variant).toBe("warning")
  })
})
