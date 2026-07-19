/**
 * Feature 015 T010–T013 — edit/view modal contract + control dispatch parity
 * (FR9, FR10, FR11, FR12, FR17, FR18). Pins the pure pre-fill extraction, the
 * in-modal failure reason, and — through the real `executeOperatorCommand` spy
 * seam — that Save forwards the typed display for the in-modal error surface and
 * that a toggle's opposite verb / a tri-state's selected mode ride the SAME
 * canonical command id as slash/CLI (no new dispatch path).
 */
import { describe, expect, test } from "bun:test"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import { executeOperatorCommand } from "../../src/operator/execute"
import { resolveOperatorEditPrefill } from "../../src/operator/form/edit-descriptor"
import { failureReason } from "../../src/operator/form/edit-modal"
import { resolveOperatorFormField } from "../../src/operator/form"
import { toStatusNodes } from "../../src/operator/status"
import { createSpyPort, createFakeToast, createFakeDialog, spyDisplay } from "./harness"

const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
function entry(id: string): OperatorPaletteEntry {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`missing entry ${id}`)
  return e
}

describe("Feature 015 T011 — edit-modal pre-fill extraction (FR9, FR10)", () => {
  test("langlock.set pre-fills the current tag from langlock.status", () => {
    const prefill = resolveOperatorEditPrefill("langlock.set")
    expect(prefill?.readId).toBe("langlock.status")
    expect(prefill!.extract({ tag: "pt-BR", enabled: true })).toBe("pt-BR")
  })

  test("output policy setters pre-fill the current object as JSON from output.stat", () => {
    const retention = resolveOperatorEditPrefill("output.retention.set")
    expect(retention?.readId).toBe("output.stat")
    expect(retention!.extract({ retention: { ttlSeconds: 86400, legalHold: false } })).toBe(
      '{"ttlSeconds":86400,"legalHold":false}',
    )
  })

  test("an absent value yields undefined (honest empty field + placeholder, never a fabricated default)", () => {
    const prefill = resolveOperatorEditPrefill("langlock.set")
    expect(prefill!.extract(undefined)).toBeUndefined()
    expect(prefill!.extract(null)).toBeUndefined()
    expect(prefill!.extract({ other: 1 })).toBeUndefined()
  })

  test("a verb with no defined current-value read opens with an empty field (no prefill descriptor)", () => {
    expect(resolveOperatorEditPrefill("routing.configure")).toBeUndefined()
    // Secret-bearing rotate is never pre-filled from a resolved value (FR15).
    expect(resolveOperatorEditPrefill("semantic.provider.rotate-secret")).toBeUndefined()
  })
})

describe("Feature 015 T012 — in-modal failure reason (FR12, FR18)", () => {
  test("prefers the dispatch display message, else falls back to the typed outcome", () => {
    expect(failureReason({ outcome: "invalid_argument", display: { message: "endpoint is invalid" } })).toBe(
      "endpoint is invalid",
    )
    expect(failureReason({ outcome: "conflict" })).toBe("Save failed: conflict")
    expect(failureReason({})).toBe("Save failed")
  })
})

describe("Feature 015 T012 — Save forwards the typed display for the in-modal surface (FR12, FR18)", () => {
  test("a committed Save carries the display so the modal closes; the outcome is success", async () => {
    const spy = createSpyPort()
    const { toast, calls } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: entry("langlock.set"),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      payload: { tag: "pt-BR" },
      silent: true,
    })
    expect(result.outcome).toBe("success")
    expect(result.display?.outcome).toBe("success")
    // silent Save emits no toast — the modal close is the feedback (FR18).
    expect(calls).toHaveLength(0)
  })

  test("a failed Save forwards the typed reason and emits no toast under silent (FR12, FR18)", async () => {
    const spy = createSpyPort(() =>
      spyDisplay({ variant: "warning", outcome: "invalid_argument", message: "tag not in allowlist" }),
    )
    const { toast, calls } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: entry("langlock.set"),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      payload: { tag: "zz" },
      silent: true,
    })
    expect(result.outcome).toBe("invalid_argument")
    expect(failureReason(result)).toBe("tag not in allowlist")
    expect(calls).toHaveLength(0)
  })
})

/**
 * Faithful model of `OperatorEditModal.submitText`: validate the raw field value
 * IN-MODAL before any dispatch; only a valid value reaches the wire, carrying the
 * descriptor's EXACT payload keys (the Feature 014 wrapper-key lesson). Returns the
 * spy so a test can assert whether a dispatch actually happened.
 */
async function submitText(id: string, raw: string) {
  const field = resolveOperatorFormField(entry(id))
  if (!field || field.mode !== "text_input") throw new Error(`expected text_input field for ${id}`)
  const validation = field.validate(raw)
  const spy = createSpyPort()
  const { toast, calls } = createFakeToast()
  let error: string | undefined
  if (!validation.ok) {
    error = validation.message
  } else {
    await executeOperatorCommand({
      entry: entry(id),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      payload: field.toPayload(validation.value),
      silent: true,
    })
  }
  return { spy, calls, error }
}

describe("Feature 015 T022 — edit modal blocks invalid input BEFORE any dispatch (FR9, FR12, FR16)", () => {
  test("an invalid value sets the in-modal error and never reaches the wire (no phantom dispatch)", async () => {
    // A JSON field rejects malformed input in-modal; no preflight, no tryHandle.
    const { spy, error } = await submitText("semantic.provider.add", "not json")
    expect(error).toBeDefined()
    expect(spy.tryHandleCalls).toHaveLength(0)
    expect(spy.preflightCalls).toHaveLength(0)
  })

  test("a valid value dispatches once, carrying the descriptor's EXACT payload keys (014 wrapper-key lesson)", async () => {
    const { spy, calls } = await submitText(
      "semantic.provider.add",
      '{"name":"vec","baseUrl":"https://v.example","secretRef":"keychain:k@v1"}',
    )
    expect(spy.tryHandleCalls).toHaveLength(1)
    const sent = spy.tryHandleCalls[0].text
    expect(sent.startsWith("/op.semantic.provider.add ")).toBe(true)
    // top-level keys the port reads — no `{ provider: "…json…" }` wrapper.
    expect(JSON.parse(sent.slice(sent.indexOf(" ") + 1))).toEqual({
      name: "vec",
      baseUrl: "https://v.example",
      secretRef: "keychain:k@v1",
    })
    // silent Save → the modal close is the feedback, no toast (FR18).
    expect(calls).toHaveLength(0)
  })

  test("a value_picker edit dispatches the selected option under the descriptor's key, never free text", () => {
    const field = resolveOperatorFormField(entry("langlock.set"))
    if (!field || field.mode !== "value_picker") throw new Error("expected value_picker")
    const option = field.options()[0]
    // Mirrors PickerBody.onSelect: payload is a single { [field.key]: option.value }.
    const payload: Record<string, unknown> = { [field.key]: option.value }
    expect(payload).toEqual({ tag: option.value })
  })
})

describe("Feature 015 T022 — structural view modal renders the key/value tree, honest empty (FR11, FR18)", () => {
  test("a detail read projects its effective into a bounded key/value tree, silently (no toast)", async () => {
    const spy = createSpyPort(() => spyDisplay(), () => ({
      outcome: "success",
      effective: { activeProfile: "default", strategy: "balanced", nested: { a: 1 } },
      version: null,
    }))
    const { toast, calls } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: entry("routing.status"),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      // The view modal reads silently — its honesty is the empty tree, never a toast.
      silent: true,
    })
    expect(calls).toHaveLength(0)
    expect(toStatusNodes(result.result?.effective)).toEqual([
      { key: "activeProfile", value: "default" },
      { key: "strategy", value: "balanced" },
      { key: "nested", value: "{1}" },
    ])
  })

  test("an absent detail effective renders the honest empty tree (`No detail reported`), never a synthesized value", async () => {
    const spy = createSpyPort(() => spyDisplay(), () => ({ outcome: "success", version: null }))
    const { toast } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: entry("routing.status"),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      silent: true,
    })
    expect(result.result?.effective).toBeUndefined()
    expect(toStatusNodes(result.result?.effective)).toEqual([])
  })
})

describe("Feature 015 T008/T009 — control dispatch parity (FR7, FR8, FR17)", () => {
  test("a toggle's opposite verb rides the SAME canonical command id as slash/CLI", async () => {
    const spy = createSpyPort()
    const { toast } = createFakeToast()
    // Screen state enabled → the toggle dispatches telemetry.off (the opposite).
    await executeOperatorCommand({ entry: entry("telemetry.off"), port: spy.port, dialog: createFakeDialog(), toast })
    expect(spy.tryHandleCalls[0].text).toBe("/op.telemetry.off")
  })

  test("a tri-state selection dispatches the selected mode's canonical verb", async () => {
    const spy = createSpyPort()
    const { toast } = createFakeToast()
    await executeOperatorCommand({ entry: entry("smart.auto"), port: spy.port, dialog: createFakeDialog(), toast })
    expect(spy.tryHandleCalls[0].text).toBe("/op.smart.auto")
  })
})
