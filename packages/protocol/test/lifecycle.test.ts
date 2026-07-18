import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import * as Lifecycle from "../src/lifecycle"

// Encoded fixtures use epoch millis for timestamps (DateTimeUtcFromMillis
// decodes/encodes through DateTime.Utc), mirroring
// packages/schema/test/lifecycle-process-row.test.ts and
// packages/schema/test/lifecycle-envelope.test.ts.

const validEnvelope = {
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
  hierarchy: null,
}

describe("LifecyclePort payloads", () => {
  test("LifecycleEmitInput round trips an EmitEnvelope missing eventId/timestamp/sequence", () => {
    const input = {
      envelope: {
        kind: validEnvelope.kind,
        tree: validEnvelope.tree,
        process: validEnvelope.process,
        ordering: { correlation_id: "corr_1", causation_id: null, attempt: 1, generation: 0 },
        delivery: { visibility: "session", redacted_metadata: { origin: "runtime" } },
        hierarchy: null,
      },
      eventType: "lifecycle.started",
      data: { note: "started" },
    }
    const decoded = Schema.decodeUnknownSync(Lifecycle.LifecycleEmitInput)(input)

    expect(Schema.encodeSync(Lifecycle.LifecycleEmitInput)(decoded) as unknown).toEqual(input)
  })

  test("LifecycleEmitOutput round trips a durable commit result", () => {
    const input = { eventId: "evt_abc123", durable: { aggregateID: "proc_1", seq: 3, version: 1 } }
    const decoded = Schema.decodeUnknownSync(Lifecycle.LifecycleEmitOutput)(input)

    expect(Schema.encodeSync(Lifecycle.LifecycleEmitOutput)(decoded) as unknown).toEqual(input)
  })

  test("LifecycleEmitOutput round trips a live (non-durable) publish", () => {
    const input = { eventId: "evt_def456", durable: null }
    const decoded = Schema.decodeUnknownSync(Lifecycle.LifecycleEmitOutput)(input)

    expect(Schema.encodeSync(Lifecycle.LifecycleEmitOutput)(decoded) as unknown).toEqual(input)
  })

  test("LifecycleProjectOutput round trips an applied projection with a row", () => {
    const input = { applied: true, anomaly: null, row: validRow }
    const decoded = Schema.decodeUnknownSync(Lifecycle.LifecycleProjectOutput)(input)

    expect(Schema.encodeSync(Lifecycle.LifecycleProjectOutput)(decoded) as unknown).toEqual(input)
  })

  test("LifecycleProjectOutput round trips a duplicate anomaly with no applied state change", () => {
    const input = { applied: false, anomaly: { kind: "duplicate" as const, eventId: "evt_abc123" }, row: null }
    const decoded = Schema.decodeUnknownSync(Lifecycle.LifecycleProjectOutput)(input)

    expect(Schema.encodeSync(Lifecycle.LifecycleProjectOutput)(decoded) as unknown).toEqual(input)
  })

  test("LifecycleReplayInput round trips with and without the optional cursor", () => {
    const withCursor = { scope: "root" as const, scopeId: "proc_root", after: 5, limit: 50 }
    const decodedWithCursor = Schema.decodeUnknownSync(Lifecycle.LifecycleReplayInput)(withCursor)
    expect(Schema.encodeSync(Lifecycle.LifecycleReplayInput)(decodedWithCursor) as unknown).toEqual(withCursor)

    const withoutCursor = { scope: "session" as const, scopeId: "ses_1", limit: 50 }
    const decodedWithoutCursor = Schema.decodeUnknownSync(Lifecycle.LifecycleReplayInput)(withoutCursor)
    expect(Schema.encodeSync(Lifecycle.LifecycleReplayInput)(decodedWithoutCursor) as unknown).toEqual(withoutCursor)
  })

  test("LifecycleReplayOutput round trips a reconciled replay page", () => {
    const input = { rows: [validRow], hasMore: false, cursor: null, reconciledCount: 1, unreconciledCount: 0 }
    const decoded = Schema.decodeUnknownSync(Lifecycle.LifecycleReplayOutput)(input)

    expect(Schema.encodeSync(Lifecycle.LifecycleReplayOutput)(decoded) as unknown).toEqual(input)
  })

  test("LifecycleError round trips every closed variant", () => {
    const variants = [
      { type: "unknown_event_type" as const, eventType: "lifecycle.bogus" },
      { type: "validation_failed" as const, fields: { data: "required" } },
      { type: "second_authority_rejected" as const, reason: "not canonical" },
      { type: "unavailable" as const, reason: "offline" },
      { type: "not_implemented" as const },
    ]
    for (const input of variants) {
      const decoded = Schema.decodeUnknownSync(Lifecycle.LifecycleError)(input)
      expect(Schema.encodeSync(Lifecycle.LifecycleError)(decoded) as unknown).toEqual(input)
    }
  })
})

describe("ProcessPort payloads", () => {
  test("ProcessListInput round trips optional states/cursor filters", () => {
    const input = { scope: "tree" as const, scopeId: "ses_root", states: ["running", "queued"], limit: 25 }
    const decoded = Schema.decodeUnknownSync(Lifecycle.ProcessListInput)(input)

    expect(Schema.encodeSync(Lifecycle.ProcessListInput)(decoded) as unknown).toEqual(input)
  })

  test("ProcessListOutput round trips a page of rows", () => {
    const input = { rows: [validRow], cursor: "cursor-2" }
    const decoded = Schema.decodeUnknownSync(Lifecycle.ProcessListOutput)(input)

    expect(Schema.encodeSync(Lifecycle.ProcessListOutput)(decoded) as unknown).toEqual(input)
  })

  test("ProcessShowInput/Output round trip", () => {
    const input = { processId: "proc_1" }
    const decoded = Schema.decodeUnknownSync(Lifecycle.ProcessShowInput)(input)
    expect(Schema.encodeSync(Lifecycle.ProcessShowInput)(decoded) as unknown).toEqual(input)

    const output = { row: validRow }
    const decodedOutput = Schema.decodeUnknownSync(Lifecycle.ProcessShowOutput)(output)
    expect(Schema.encodeSync(Lifecycle.ProcessShowOutput)(decodedOutput) as unknown).toEqual(output)
  })

  test("ProcessTreeOutput round trips direct-child-only nodes", () => {
    const input = { nodes: [{ row: validRow, childProcessIds: ["proc_2", "proc_3"] }] }
    const decoded = Schema.decodeUnknownSync(Lifecycle.ProcessTreeOutput)(input)

    expect(Schema.encodeSync(Lifecycle.ProcessTreeOutput)(decoded) as unknown).toEqual(input)
  })

  test("ProcessCancelInput round trips with an operator principal", () => {
    const input = {
      processId: "proc_1",
      reason: "operator requested",
      principal: { kind: "operator" as const, id: "op_1" },
    }
    const decoded = Schema.decodeUnknownSync(Lifecycle.ProcessCancelInput)(input)

    expect(Schema.encodeSync(Lifecycle.ProcessCancelInput)(decoded) as unknown).toEqual(input)
  })

  test("ProcessCancelOutput round trips every CancelOutcome", () => {
    for (const outcome of ["requested", "accepted", "rejected", "unknown", "unconfirmed"] as const) {
      const input = { outcome, auditId: "audit_1" }
      const decoded = Schema.decodeUnknownSync(Lifecycle.ProcessCancelOutput)(input)
      expect(Schema.encodeSync(Lifecycle.ProcessCancelOutput)(decoded) as unknown).toEqual(input)
    }
  })

  test("ProcessReconcileInput/Output round trip", () => {
    const input = { scope: "session" as const, scopeId: "ses_1", principal: { kind: "manager-view" as const, id: "mgr_1" } }
    const decoded = Schema.decodeUnknownSync(Lifecycle.ProcessReconcileInput)(input)
    expect(Schema.encodeSync(Lifecycle.ProcessReconcileInput)(decoded) as unknown).toEqual(input)

    const output = { reconciledCount: 4, unreconciledCount: 1 }
    const decodedOutput = Schema.decodeUnknownSync(Lifecycle.ProcessReconcileOutput)(output)
    expect(Schema.encodeSync(Lifecycle.ProcessReconcileOutput)(decodedOutput) as unknown).toEqual(output)
  })

  test("ProcessError round trips every closed variant", () => {
    const variants = [
      { type: "not_found" as const, processId: "proc_9" },
      { type: "unauthorized" as const, reason: "sibling leak" },
      { type: "cancel_rejected" as const, processId: "proc_1", reason: "already terminal" },
      { type: "invalid_argument" as const, field: "limit", reason: "must be positive" },
      { type: "unavailable" as const, reason: "offline" },
      { type: "not_implemented" as const },
    ]
    for (const input of variants) {
      const decoded = Schema.decodeUnknownSync(Lifecycle.ProcessError)(input)
      expect(Schema.encodeSync(Lifecycle.ProcessError)(decoded) as unknown).toEqual(input)
    }
  })
})

describe("ObservationPort payloads", () => {
  test("LifecycleObservation round trips an envelope with a redacted data record and no anomaly", () => {
    const input = { envelope: validEnvelope, data: { label: "reading file" }, anomaly: null }
    const decoded = Schema.decodeUnknownSync(Lifecycle.LifecycleObservation)(input)

    expect(Schema.encodeSync(Lifecycle.LifecycleObservation)(decoded) as unknown).toEqual(input)
  })

  test("LifecycleObservation round trips every ProjectionAnomaly variant", () => {
    const variants = [
      { kind: "duplicate" as const, eventId: "evt_abc123" },
      { kind: "out_of_order" as const, aggregateID: "proc_1", expectedSeq: 4, actualSeq: 6 },
      { kind: "unknown_process" as const, processId: "proc_1" },
      { kind: "unreconciled" as const, processId: "proc_1" },
    ]
    for (const anomaly of variants) {
      const input = { envelope: validEnvelope, data: {}, anomaly }
      const decoded = Schema.decodeUnknownSync(Lifecycle.LifecycleObservation)(input)
      expect(Schema.encodeSync(Lifecycle.LifecycleObservation)(decoded) as unknown).toEqual(input)
    }
  })

  test("ObserverPrincipal round trips every principal variant", () => {
    const variants = [
      { kind: "main-context" as const, rootSessionId: "ses_root" },
      { kind: "agent" as const, sessionId: "ses_1" },
      { kind: "subagent" as const, sessionId: "ses_1" },
      { kind: "operator" as const, id: "op_1" },
      { kind: "manager-view" as const, id: "mgr_1" },
    ]
    for (const principal of variants) {
      const input = { processId: "proc_1", principal }
      const decoded = Schema.decodeUnknownSync(Lifecycle.ProcessObserveInput)(input)
      expect(Schema.encodeSync(Lifecycle.ProcessObserveInput)(decoded) as unknown).toEqual(input)
    }
  })

  test("ObserveSessionInput/ObserveProcessInput/ObserveTreeInput round trip", () => {
    const principal = { kind: "operator" as const, id: "op_1" }

    const session = { sessionId: "ses_1", principal }
    const decodedSession = Schema.decodeUnknownSync(Lifecycle.ObserveSessionInput)(session)
    expect(Schema.encodeSync(Lifecycle.ObserveSessionInput)(decodedSession) as unknown).toEqual(session)

    const process = { processId: "proc_1", principal }
    const decodedProcess = Schema.decodeUnknownSync(Lifecycle.ObserveProcessInput)(process)
    expect(Schema.encodeSync(Lifecycle.ObserveProcessInput)(decodedProcess) as unknown).toEqual(process)

    const tree = { rootSessionId: "ses_root", principal }
    const decodedTree = Schema.decodeUnknownSync(Lifecycle.ObserveTreeInput)(tree)
    expect(Schema.encodeSync(Lifecycle.ObserveTreeInput)(decodedTree) as unknown).toEqual(tree)
  })

  test("ObserveGlobalInput round trips a bounded global filter", () => {
    const input = {
      filter: { states: ["running", "cancelling"], hierarchyRoles: ["manager"], agentKinds: ["worker"], limit: 100 },
      principal: { kind: "operator" as const, id: "op_1" },
    }
    const decoded = Schema.decodeUnknownSync(Lifecycle.ObserveGlobalInput)(input)

    expect(Schema.encodeSync(Lifecycle.ObserveGlobalInput)(decoded) as unknown).toEqual(input)
  })

  test("ObservationError round trips every closed variant", () => {
    const variants = [
      { type: "unauthorized" as const, reason: "no session grant" },
      { type: "sibling_leak_rejected" as const, reason: "cross-project" },
      { type: "invalid_filter" as const, field: "limit", reason: "exceeds bound" },
      { type: "unavailable" as const, reason: "offline" },
      { type: "not_implemented" as const },
    ]
    for (const input of variants) {
      const decoded = Schema.decodeUnknownSync(Lifecycle.ObservationError)(input)
      expect(Schema.encodeSync(Lifecycle.ObservationError)(decoded) as unknown).toEqual(input)
    }
  })
})
