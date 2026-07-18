import { describe, expect, test } from "bun:test"
import { BindingLifecycle } from "@opencode-ai/core/semantic/binding-lifecycle"

// Feature 006 / T017 (S8) — the pinned-binding lifecycle machine: legal/illegal
// transitions, in-flight version pinning, no auto-substitution on outage (FR31,
// FR32, C12, C20, AC27, AC29, AC33).

type State = BindingLifecycle.BindingState

const expectTo = (state: State, trigger: BindingLifecycle.Trigger, to: State) => {
  const r = BindingLifecycle.apply(state, trigger)
  expect(r.kind).toBe("transition")
  if (r.kind === "transition") expect(r.to).toBe(to)
}
const expectIllegal = (state: State, trigger: BindingLifecycle.Trigger) =>
  expect(BindingLifecycle.apply(state, trigger).kind).toBe("illegal")

describe("BindingLifecycle — states and creation", () => {
  test("exposes exactly the five binding states", () => {
    expect(BindingLifecycle.BINDING_STATES).toEqual(["draft", "staged", "active", "degraded", "unavailable"])
  })
  test("select stages a candidate version from the initial pseudo-state", () => {
    const created = BindingLifecycle.create("select")
    expect(created.ok && created.state).toBe("draft")
    expect(BindingLifecycle.create("cutover").ok).toBe(false)
  })
})

describe("BindingLifecycle — legal transitions", () => {
  test("select -> validate/reindex -> cutover activates", () => {
    expectTo("draft", "validate", "staged")
    expectTo("draft", "reindex", "staged")
    expectTo("staged", "cutover", "active")
  })
  test("outage degrades then reaches unavailable; recover restores active", () => {
    expectTo("active", "outage", "degraded")
    expectTo("degraded", "outage_persists", "unavailable")
    expectTo("degraded", "recover", "active")
  })
  test("re-select and rollback from active", () => {
    expectTo("active", "select", "staged")
    // rollback restores a superseded version; the state stays active (self-loop).
    expect(BindingLifecycle.apply("active", "rollback").kind).toBe("unchanged")
    expectTo("unavailable", "select", "draft")
  })
})

describe("BindingLifecycle — illegal transitions", () => {
  test("cutover cannot activate a draft (validate/reindex must run first)", () => {
    expectIllegal("draft", "cutover")
    expectIllegal("degraded", "cutover")
    expectIllegal("unavailable", "recover")
  })
  test("a duplicate cutover delivered to an active binding is an idempotent no-op", () => {
    expect(BindingLifecycle.apply("active", "cutover").kind).toBe("unchanged")
  })
})

describe("BindingLifecycle — no auto-substitution on outage (AC29)", () => {
  test("degrade carries the same model ref and operator version unchanged", () => {
    const snap = BindingLifecycle.step({ state: "active", version: 4, model_ref: "m-embed" }, "outage")
    expect(snap.state).toBe("degraded")
    expect(snap.version).toBe(4)
    expect(snap.model_ref).toBe("m-embed")
    const gone = BindingLifecycle.step(snap, "outage_persists")
    expect(gone.state).toBe("unavailable")
    expect(gone.model_ref).toBe("m-embed")
  })
})

describe("BindingLifecycle — in-flight version pinning (FR32, AC33)", () => {
  test("a pinned version survives a mid-task operator cutover", () => {
    const pinned = BindingLifecycle.pinForTask({ version: 7, model_ref: "m-embed" })
    // operator cuts over to version 8 mid-task; the running Task still resolves 7.
    expect(BindingLifecycle.resolvePinned(pinned, 8).version).toBe(7)
    expect(BindingLifecycle.resolvePinned(pinned, 8).model_ref).toBe("m-embed")
  })
})
