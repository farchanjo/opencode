/**
 * Feature 002 / T028 — single-owner handoff coordination. Asserts one durable
 * handoff event is emitted carrying both endpoints, reason, and generation (C16,
 * FR22, AC6). In-process fixture style.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createHandoffCoordinator, type LifecycleEmitter } from "@/lifecycle/handoff"
import type { LifecycleEmitInput, LifecycleEmitOutput } from "@opencode-ai/protocol/lifecycle/commands"
import { emitEnvelope } from "./fixtures"

function capturingEmitter() {
  const calls: LifecycleEmitInput[] = []
  const emitter: LifecycleEmitter = {
    emit: (input) => {
      calls.push(input)
      return Effect.succeed({ eventId: "evt_h", durable: { aggregateID: "proc_root", seq: 3, version: 1 } } as unknown as LifecycleEmitOutput)
    },
  }
  return { emitter, calls }
}

describe("T028 handoff coordinator", () => {
  test("publishes exactly one durable handoff event with both endpoints", async () => {
    const { emitter, calls } = capturingEmitter()
    const coordinator = createHandoffCoordinator({ emitter })

    const out = await Effect.runPromise(
      coordinator.handoff({
        envelope: emitEnvelope({ eventType: "lifecycle.handoff", sessionId: "ses_src", processId: "proc_src" }),
        source: { sessionId: "ses_src" as never, processId: "proc_src" as never },
        target: { sessionId: "ses_dst" as never, processId: "proc_dst" as never },
        reason: "delegation" as never,
        generation: 1 as never,
      }),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.eventType).toBe("lifecycle.handoff")
    const detail = calls[0]?.data as { source: { session_id: string }; target: { session_id: string }; reason: string }
    expect(detail.source.session_id).toBe("ses_src")
    expect(detail.target.session_id).toBe("ses_dst")
    expect(detail.reason).toBe("delegation")
    expect(out.durable?.seq).toBe(3)
  })
})
