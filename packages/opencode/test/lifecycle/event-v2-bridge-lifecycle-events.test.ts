/**
 * Feature 002 / T015 — bridges the `LifecycleEvents.LifecycleEvent` 26-member
 * closed vocabulary (`packages/schema/src/lifecycle/events.ts`, FR20) onto the
 * real EventV2 bus through `EventV2Bridge.Service.publishLifecycleEvent`.
 * Verifies every union member round-trips through its own wire `Definition`
 * (`@opencode-ai/core/lifecycle/event-bus`, T014) with no drift from the
 * schema owner, that the eleven durable members carry the synthetic
 * top-level `root_process_id` aggregate key the durable-commit path requires
 * (C8), and that a bus subscriber observes a bridged event.
 */
import { describe, expect } from "bun:test"
import { DateTime, Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { Events as LifecycleEvents } from "@opencode-ai/schema/lifecycle/events"
import { EventV2Bridge } from "@/event-v2-bridge"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([EventV2Bridge.node])))

const envelope = {
  event_id: "evt_abc123",
  kind: {
    event_type: "lifecycle.started",
    schema_version: 1,
    event_class: "durable",
    agent_kind: "worker",
    actor_kind: "runtime",
    runtime_instance_id: "rt_1",
  },
  tree: { root_session_id: "ses_root", session_id: "ses_1", parent_session_id: null },
  process: { task_id: "task_1", process_id: "proc_1", parent_process_id: null, root_process_id: "proc_root" },
  ordering: { sequence: 0, correlation_id: "corr_1", causation_id: null, attempt: 1, generation: 0 },
  delivery: { visibility: "session", timestamp: DateTime.makeUnsafe(1_721_260_800_000), redacted_metadata: {} },
  hierarchy: null,
} as const

const liveUsage = {
  available: true,
  tokens: { input: 10, output: 5 },
  cost_usd: 0.01,
  provenance: { provenance: "reported", source: "provider" },
  elapsed_ms: 1000,
  tokens_per_second: 5,
} as const

const admissionDetail = { scope: "session", decision: "granted", fanout: { requested: 2, granted: 1 } } as const
const terminalDetail = { reason: "completed_ok", settlement: "settled", final_usage: liveUsage } as const
const toolDetail = { activity: "read", label: "reading config" } as const

const SAMPLE_DURABLE_EVENT: LifecycleEvents.LifecycleEvent = {
  type: "lifecycle.admitted",
  envelope,
  detail: admissionDetail,
} as unknown as LifecycleEvents.LifecycleEvent

const SAMPLE_TERMINAL_EVENT: LifecycleEvents.LifecycleEvent = {
  type: "lifecycle.completed",
  envelope,
  detail: terminalDetail,
} as unknown as LifecycleEvents.LifecycleEvent

const SAMPLE_LIVE_EVENT: LifecycleEvents.LifecycleEvent = {
  type: "lifecycle.tool_called",
  envelope,
  detail: toolDetail,
} as unknown as LifecycleEvents.LifecycleEvent

describe("T015 EventV2Bridge lifecycle event bridging", () => {
  it.instance('publishLifecycleEvent round-trips a durable "lifecycle.admitted" event with an injected root_process_id', () =>
    Effect.gen(function* () {
      const bridge = yield* EventV2Bridge.Service
      const payload = yield* bridge.publishLifecycleEvent(SAMPLE_DURABLE_EVENT)
      expect(payload.type).toBe("lifecycle.admitted")
      expect(payload.data).toEqual({
        envelope,
        detail: admissionDetail,
        root_process_id: envelope.process.root_process_id,
      })
      expect(payload.durable?.aggregateID).toBe(envelope.process.root_process_id)
    }),
  )

  it.instance('publishLifecycleEvent round-trips a durable terminal "lifecycle.completed" event', () =>
    Effect.gen(function* () {
      const bridge = yield* EventV2Bridge.Service
      const payload = yield* bridge.publishLifecycleEvent(SAMPLE_TERMINAL_EVENT)
      expect(payload.type).toBe("lifecycle.completed")
      expect(payload.data).toEqual({
        envelope,
        detail: terminalDetail,
        root_process_id: envelope.process.root_process_id,
      })
    }),
  )

  it.instance('publishLifecycleEvent round-trips a live "lifecycle.tool_called" event with no aggregate key', () =>
    Effect.gen(function* () {
      const bridge = yield* EventV2Bridge.Service
      const payload = yield* bridge.publishLifecycleEvent(SAMPLE_LIVE_EVENT)
      expect(payload.type).toBe("lifecycle.tool_called")
      expect(payload.data).toEqual({ envelope, detail: toolDetail })
      expect(payload.durable).toBeUndefined()
    }),
  )

  it.instance("a bus subscriber observes a bridged lifecycle.admitted event", () =>
    Effect.gen(function* () {
      const bridge = yield* EventV2Bridge.Service
      const seen: unknown[] = []
      const unsub = yield* bridge.listen((event) => {
        if (event.type === "lifecycle.admitted") seen.push(event.data)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsub)

      yield* bridge.publishLifecycleEvent(SAMPLE_DURABLE_EVENT)

      expect(seen).toHaveLength(1)
    }),
  )
})
