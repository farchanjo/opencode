import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Row } from "../src/lifecycle/process-row"

// Encoded form (timestamps as epoch millis; DateTimeUtcFromMillis decodes them
// to DateTime.Utc, so identity is asserted through an encode round-trip).
const validRow = {
  id: "p1",
  identity: { task_id: "t1", attempt: 1, generation: 0, lease_id: "l1" },
  lineage: {
    relations: {
      parent_process_id: null,
      root_process_id: "rp1",
      session_id: "s1",
      parent_session_id: null,
      root_session_id: "rs1",
    },
    ownership: { runtime_instance_id: "rt1", scope: "session", actor_kind: "runtime" },
    graph: { dependencies: [], children: [], pending_inputs: [], pending_steers: [] },
  },
  status: {
    state: "running",
    reason: null,
    settlement: null,
    created_at: 1_720_000_000_000,
    updated_at: 1_720_000_001_000,
    terminal_at: null,
  },
  profile: {
    classification: {
      agent_name: "agent",
      agent_kind: "worker",
      task_class: "large",
      profile: "manager",
      task_effort: "high",
      reasoning_effort: "medium",
    },
    model: { provider: "anthropic", model: "claude", variant: null },
  },
  accounting: {
    usage: {
      usage: {
        available: true,
        tokens: { input: 10, output: 20, reasoning: 5, cache_read: 0, cache_write: 0 },
        cost_usd: 0.01,
        provenance: { provenance: "reported", source: "provider" },
        elapsed_ms: 1_000,
        tokens_per_second: 20,
      },
      ttft_ms: 120,
      stream_ms: 800,
      total_ms: 1_000,
    },
    outcome: { cancel_outcome: null, exit_reason: null, error_reason: null },
    telemetry: { trace_id: null, span_id: null, output_ref: null },
  },
  hierarchy: {
    role: "worker",
    delegation_depth: 2,
    route_path: ["s1"],
    fanout: { requested: 1, granted: 1 },
    validation_outcome: null,
  },
}

describe("Row.ProcessRow", () => {
  test("round-trips a valid row through decode and encode", () => {
    const decoded = Schema.decodeUnknownSync(Row.ProcessRow)(validRow)
    expect(Schema.encodeSync(Row.ProcessRow)(decoded) as unknown).toEqual(validRow)
  })

  test("rejects a state outside the ten-member ProcessState union", () => {
    expect(() =>
      Schema.decodeUnknownSync(Row.ProcessRow)({
        ...validRow,
        status: { ...validRow.status, state: "paused" },
      }),
    ).toThrow()
  })

  test("rejects a non-positive attempt (attempt is 1-based)", () => {
    expect(() =>
      Schema.decodeUnknownSync(Row.ProcessRow)({
        ...validRow,
        identity: { ...validRow.identity, attempt: 0 },
      }),
    ).toThrow()
  })

  test("accepts a null hierarchy when Smart routing is inactive", () => {
    const decoded = Schema.decodeUnknownSync(Row.ProcessRow)({ ...validRow, hierarchy: null })
    expect(decoded.hierarchy).toBeNull()
  })
})

describe("Row.RowStatus", () => {
  test("rejects a settlement outside the closed union", () => {
    expect(() =>
      Schema.decodeUnknownSync(Row.RowStatus)({
        state: "completed",
        reason: "completed_ok",
        settlement: "sealed",
        created_at: 1_720_000_000_000,
        updated_at: 1_720_000_000_000,
        terminal_at: 1_720_000_000_000,
      }),
    ).toThrow()
  })
})
