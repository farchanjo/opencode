/**
 * Feature 005 / T029 (S17) — startup reconciler.
 * Asserts recovery into each state and a visible sealed ref after
 * crash-after-seal-before-event, never a silent empty-success (FR25, C12, AC8,
 * AC9).
 */
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { ControlStore } from "@/outputspool/control-store"
import { Reconciler } from "@/outputspool/reconciler"

const setup = () => {
  const store = ControlStore.createControlStore(new Database(":memory:"))
  const emitted: string[] = []
  return { store, emitted }
}

const openGen = (store: ControlStore.ControlStore, ref: string) =>
  store.openGeneration({ output_ref: ref, group_id: "g", generation: 0, channel: "stdout", durability_tier: "durable", correlation_id: "c", now: 1 })

describe("reconciler", () => {
  test("extent >= committed with a seal record recovers as sealed (crash after seal before event)", async () => {
    const { store, emitted } = setup()
    openGen(store, "sealed-ref")
    store.recordCommitted("sealed-ref", 10, 1)
    store.recordSeal("sealed-ref", "tag", 2)
    // The seal record survives; the reconciler re-emits the settlement.
    store.setState("sealed-ref", "open", 3) // simulate a pre-event open snapshot
    const r = Reconciler.createReconciler({
      store,
      extentOf: () => 10,
      emit: (s) => void emitted.push(`${s.output_ref}:${s.outcome}`),
    })
    const settlements = await r.run()
    expect(settlements[0].outcome).toBe("sealed")
    expect(emitted).toContain("sealed-ref:sealed")
    expect(store.get("sealed-ref")!.state).toBe("sealed")
  })

  test("extent < committed recovers as corrupt", async () => {
    const { store } = setup()
    openGen(store, "corrupt-ref")
    store.recordCommitted("corrupt-ref", 100, 1)
    const r = Reconciler.createReconciler({ store, extentOf: () => 40 })
    const [settlement] = await r.run()
    expect(settlement.outcome).toBe("corrupt")
  })

  test("seal requested but no seal record recovers as unknown", async () => {
    const { store } = setup()
    openGen(store, "unknown-ref")
    store.recordCommitted("unknown-ref", 10, 1)
    store.markSealRequested("unknown-ref", 2)
    const r = Reconciler.createReconciler({ store, extentOf: () => 10 })
    const [settlement] = await r.run()
    expect(settlement.outcome).toBe("unknown")
  })
})
