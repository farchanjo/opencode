/**
 * Feature 002 / T029 — native root-tree cancellation. Asserts the outcome matrix
 * (C17): first Ctrl+C fences and requests every descendant (visible + invisible),
 * a second Ctrl+C within the window forces a local abort via the coordinator, and
 * an idle root is a no-op. In-process fixture style.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createCancelService, type CancelTarget, type LifecycleEmitter, type RootInterruptor } from "@/lifecycle/cancel"
import type { LifecycleEmitInput, LifecycleEmitOutput } from "@opencode-ai/protocol/lifecycle/commands"
import { emitEnvelope } from "./fixtures"

function harness() {
  const emitted: LifecycleEmitInput[] = []
  const interrupts: string[] = []
  const fenced: string[] = []
  const emitter: LifecycleEmitter = {
    emit: (input) => {
      emitted.push(input)
      return Effect.succeed({ eventId: "evt_c", durable: null } as unknown as LifecycleEmitOutput)
    },
  }
  const coordinator: RootInterruptor = { interrupt: (key) => Effect.sync(() => void interrupts.push(key)) }
  const fence = (root: string) => void fenced.push(root)
  return { emitter, coordinator, emitted, interrupts, fenced, fence }
}

const targets = (): ReadonlyArray<CancelTarget> => [
  { envelope: emitEnvelope({ eventType: "lifecycle.cancel_requested", processId: "proc_1" }), visible: true },
  { envelope: emitEnvelope({ eventType: "lifecycle.cancel_requested", processId: "proc_2" }), visible: false },
]

describe("T029 cancel service — outcome matrix", () => {
  test("first Ctrl+C fences the root and requests cancel of visible + invisible descendants", async () => {
    const h = harness()
    let now = 1000
    const service = createCancelService({ emitter: h.emitter, coordinator: h.coordinator, fence: h.fence, clock: () => now, escalationWindowMs: 3000 })

    const out = await Effect.runPromise(
      service.requestRootCancel({ rootProcessId: "proc_root" as never, rootKey: "run_root", principal: { kind: "operator", id: "op" }, reason: null, targets: targets() }),
    )

    expect(out.outcome).toBe("requested")
    expect(out.requestedCount).toBe(2)
    expect(h.fenced).toEqual(["proc_root"])
    expect(h.emitted).toHaveLength(2)
    expect(h.emitted.every((e) => e.eventType === "lifecycle.cancel_requested")).toBe(true)
    expect(h.interrupts).toHaveLength(0)
  })

  test("second Ctrl+C within the window forces a local abort (unconfirmed, no remote kill)", async () => {
    const h = harness()
    let now = 1000
    const service = createCancelService({ emitter: h.emitter, coordinator: h.coordinator, fence: h.fence, clock: () => now, escalationWindowMs: 3000 })
    const input = { rootProcessId: "proc_root" as never, rootKey: "run_root", principal: { kind: "operator" as const, id: "op" }, reason: null, targets: targets() }

    await Effect.runPromise(service.requestRootCancel(input))
    now = 2000 // within the 3s window
    const out = await Effect.runPromise(service.requestRootCancel(input))

    expect(out.outcome).toBe("unconfirmed")
    expect(out.escalated).toBe(true)
    expect(h.interrupts).toEqual(["run_root"])
  })

  test("a first Ctrl+C after the window has elapsed requests again, never escalates", async () => {
    const h = harness()
    let now = 1000
    const service = createCancelService({ emitter: h.emitter, coordinator: h.coordinator, fence: h.fence, clock: () => now, escalationWindowMs: 3000 })
    const input = { rootProcessId: "proc_root" as never, rootKey: "run_root", principal: { kind: "operator" as const, id: "op" }, reason: null, targets: targets() }

    await Effect.runPromise(service.requestRootCancel(input))
    now = 9000 // past the window
    const out = await Effect.runPromise(service.requestRootCancel(input))

    expect(out.outcome).toBe("requested")
    expect(h.interrupts).toHaveLength(0)
  })

  test("Ctrl+C on an idle root (no active targets) is a no-op", async () => {
    const h = harness()
    const service = createCancelService({ emitter: h.emitter, coordinator: h.coordinator, fence: h.fence })
    const out = await Effect.runPromise(
      service.requestRootCancel({ rootProcessId: "proc_root" as never, rootKey: "run_root", principal: { kind: "operator", id: "op" }, reason: null, targets: [] }),
    )
    expect(out.outcome).toBe("rejected")
    expect(h.emitted).toHaveLength(0)
    expect(h.fenced).toHaveLength(0)
  })
})
