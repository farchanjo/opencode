import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Envelope } from "../src/lifecycle/envelope"

// LifecycleEnvelope is the common carrier; hierarchy is present only when Smart
// routing is active and follows the CUE's nested delegation/correlation shape.

const baseEnvelope = {
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
  delivery: { visibility: "session", timestamp: 1_721_260_800_000, redacted_metadata: { origin: "runtime" } },
  hierarchy: null,
}

const hierarchicalEnvelope = {
  ...baseEnvelope,
  event_id: "evt_hier01",
  hierarchy: {
    role: "worker",
    delegation: { depth: 2, path: ["ses_root", "ses_1"] },
    fanout: { requested: 3, granted: 2 },
    validation_outcome: "passed",
    correlation: { decision_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", turn_id: "trn_1" },
  },
}

describe("Envelope.LifecycleEnvelope", () => {
  test("round-trips an envelope with a null hierarchy", () => {
    const decoded = Schema.decodeUnknownSync(Envelope.LifecycleEnvelope)(baseEnvelope)
    expect(Schema.encodeSync(Envelope.LifecycleEnvelope)(decoded) as unknown).toEqual(baseEnvelope)
  })

  test("round-trips an envelope carrying a Smart-routing hierarchy context", () => {
    const decoded = Schema.decodeUnknownSync(Envelope.LifecycleEnvelope)(hierarchicalEnvelope)
    expect(Schema.encodeSync(Envelope.LifecycleEnvelope)(decoded) as unknown).toEqual(hierarchicalEnvelope)
  })

  test("rejects an event_id without the evt_ prefix", () => {
    expect(() =>
      Schema.decodeUnknownSync(Envelope.LifecycleEnvelope)({ ...baseEnvelope, event_id: "abc123" }),
    ).toThrow()
  })

  test("rejects an out-of-vocabulary visibility", () => {
    expect(() =>
      Schema.decodeUnknownSync(Envelope.LifecycleEnvelope)({
        ...baseEnvelope,
        delivery: { ...baseEnvelope.delivery, visibility: "public" },
      }),
    ).toThrow()
  })

  test("rejects an attempt below one", () => {
    expect(() =>
      Schema.decodeUnknownSync(Envelope.LifecycleEnvelope)({
        ...baseEnvelope,
        ordering: { ...baseEnvelope.ordering, attempt: 0 },
      }),
    ).toThrow()
  })

  test("rejects a hierarchy decision_id that is not a ULID", () => {
    expect(() =>
      Schema.decodeUnknownSync(Envelope.LifecycleEnvelope)({
        ...hierarchicalEnvelope,
        hierarchy: {
          ...hierarchicalEnvelope.hierarchy,
          correlation: { decision_id: "not-a-ulid", turn_id: "trn_1" },
        },
      }),
    ).toThrow()
  })

  test("rejects a missing required kind sub-object", () => {
    const { kind: _kind, ...incomplete } = baseEnvelope
    expect(() => Schema.decodeUnknownSync(Envelope.LifecycleEnvelope)(incomplete)).toThrow()
  })
})
