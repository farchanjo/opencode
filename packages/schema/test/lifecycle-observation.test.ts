import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Observation } from "../src/lifecycle/observation"

const validScope = {
  kind: "session",
  session_id: "s1",
  process_id: null,
  root_session_id: null,
  visibility: "session",
}

const validFilter = {
  scope: validScope,
  event_types: ["lifecycle.started", "lifecycle.completed"],
  include_terminal: true,
}

// A minimal envelope-only durable member (lifecycle.queued) with epoch-millis
// timestamp; the delivery timestamp forces an encode round-trip for identity.
const validEnvelope = {
  event_id: "evt_1",
  kind: {
    event_type: "lifecycle.queued",
    schema_version: 1,
    event_class: "live",
    agent_kind: "worker",
    actor_kind: "runtime",
    runtime_instance_id: "rt1",
  },
  tree: { root_session_id: "rs1", session_id: "s1", parent_session_id: null },
  process: { task_id: "t1", process_id: "p1", parent_process_id: null, root_process_id: "rp1" },
  ordering: { sequence: 0, correlation_id: "c1", causation_id: null, attempt: 1, generation: 0 },
  delivery: { visibility: "session", timestamp: 1_720_000_000_000, redacted_metadata: {} },
  hierarchy: null,
}

const validResult = {
  scope: validScope,
  event: { type: "lifecycle.queued", envelope: validEnvelope },
  anomaly: null,
}

describe("Observation.ObservationScope", () => {
  test("round-trips a valid scope", () => {
    expect(Schema.decodeUnknownSync(Observation.ObservationScope)(validScope) as unknown).toEqual(validScope)
  })

  test("accepts every ObservationKind and rejects an outsider", () => {
    for (const kind of ["session", "process", "tree", "global"] as const) {
      expect(Schema.decodeUnknownSync(Observation.ObservationScope)({ ...validScope, kind }).kind).toBe(kind)
    }
    expect(() => Schema.decodeUnknownSync(Observation.ObservationScope)({ ...validScope, kind: "cluster" })).toThrow()
  })
})

describe("Observation.ObservationFilter", () => {
  test("round-trips a valid filter", () => {
    expect(Schema.decodeUnknownSync(Observation.ObservationFilter)(validFilter) as unknown).toEqual(validFilter)
  })

  test("rejects an event type outside the lifecycle vocabulary", () => {
    expect(() =>
      Schema.decodeUnknownSync(Observation.ObservationFilter)({ ...validFilter, event_types: ["routing.decision"] }),
    ).toThrow()
  })
})

describe("Observation.AnomalyRecord", () => {
  test("accepts every AnomalyKind and rejects an outsider", () => {
    for (const kind of ["duplicate", "out_of_order", "unknown_event", "unreconciled"] as const) {
      expect(
        Schema.decodeUnknownSync(Observation.AnomalyRecord)({ kind, process_id: "p1", reason: "seq gap" }).kind,
      ).toBe(kind)
    }
    expect(() =>
      Schema.decodeUnknownSync(Observation.AnomalyRecord)({ kind: "corrupt", process_id: "p1", reason: "x" }),
    ).toThrow()
  })
})

describe("Observation.ObservationResult", () => {
  test("round-trips a delivered, already-redacted event with a null anomaly", () => {
    const decoded = Schema.decodeUnknownSync(Observation.ObservationResult)(validResult)
    expect(Schema.encodeSync(Observation.ObservationResult)(decoded) as unknown).toEqual(validResult)
  })

  test("rejects an event whose type is outside the closed union", () => {
    expect(() =>
      Schema.decodeUnknownSync(Observation.ObservationResult)({
        ...validResult,
        event: { type: "lifecycle.bogus", envelope: validEnvelope },
      }),
    ).toThrow()
  })
})
