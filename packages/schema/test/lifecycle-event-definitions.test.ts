import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { EventDefinitions } from "../src/lifecycle/event-definitions"
import { Durable } from "../src/durable-event-manifest"

// Feature 002 / T014-T015 — one `EventV2.define` Definition per lifecycle
// member (FR20), the eleven-durable/fifteen-live split (C4), and the eleven
// durable members joining the canonical `Durable` inventory (C5).

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
  delivery: { visibility: "session", timestamp: 1_721_260_800_000, redacted_metadata: {} },
  hierarchy: null,
}

const liveUsage = {
  available: true,
  tokens: { input: 10, output: 5 },
  cost_usd: 0.01,
  provenance: { provenance: "reported", source: "provider" },
  elapsed_ms: 1000,
  tokens_per_second: 5,
}

const admissionDetail = { scope: "session", decision: "granted", fanout: { requested: 2, granted: 1 } }
const terminalDetail = { reason: "completed_ok", settlement: "settled", final_usage: liveUsage }

describe("EventDefinitions — lifecycle EventV2 bus wiring", () => {
  test("registers exactly twenty-six Definitions, split eleven durable / fifteen live", () => {
    expect(EventDefinitions.Definitions).toHaveLength(26)
    expect(EventDefinitions.DurableDefinitions).toHaveLength(11)
    expect(EventDefinitions.LiveDefinitions).toHaveLength(15)
  })

  test("every durable Definition carries version 1 and aggregate root_process_id", () => {
    for (const definition of EventDefinitions.DurableDefinitions) {
      expect(definition.durable).toEqual({ version: 1, aggregate: "root_process_id" })
    }
  })

  test("no live Definition carries a durable annotation", () => {
    for (const definition of EventDefinitions.LiveDefinitions) {
      expect(definition.durable).toBeUndefined()
    }
  })

  test("ByType resolves every one of the 26 lifecycle.* types", () => {
    expect(EventDefinitions.ByType.size).toBe(26)
    for (const definition of EventDefinitions.Definitions) {
      expect(EventDefinitions.ByType.get(definition.type)).toBe(definition)
    }
  })

  test("a durable Definition's data schema requires the top-level root_process_id aggregate key", () => {
    const data = { envelope, detail: admissionDetail, root_process_id: envelope.process.root_process_id }
    const decoded = Schema.decodeUnknownSync(EventDefinitions.AdmittedDefinition.data)(data)
    expect((decoded as { root_process_id: string }).root_process_id).toBe("proc_root")
    expect(() =>
      Schema.decodeUnknownSync(EventDefinitions.AdmittedDefinition.data)({ envelope, detail: admissionDetail }),
    ).toThrow()
  })

  test("a live Definition's data schema carries no top-level root_process_id key", () => {
    const decoded = Schema.decodeUnknownSync(EventDefinitions.QueuedDefinition.data)({ envelope })
    expect(decoded).not.toHaveProperty("root_process_id")
  })

  test("a durable terminal Definition round-trips envelope + detail + root_process_id", () => {
    const data = { envelope, detail: terminalDetail, root_process_id: envelope.process.root_process_id }
    const decoded = Schema.decodeUnknownSync(EventDefinitions.CompletedDefinition.data)(data)
    expect(Schema.encodeSync(EventDefinitions.CompletedDefinition.data)(decoded) as unknown).toEqual(data)
  })
})

describe("Durable manifest — the eleven lifecycle members join the canonical inventory (C5)", () => {
  test("every lifecycle durable Definition is registered under its versioned type", () => {
    for (const definition of EventDefinitions.DurableDefinitions) {
      expect(Durable.get(`${definition.type}.1`)).toBe(definition)
    }
  })

  test("no lifecycle live Definition is registered in the durable inventory", () => {
    for (const definition of EventDefinitions.LiveDefinitions) {
      expect(Durable.has(`${definition.type}.1`)).toBe(false)
    }
  })
})
