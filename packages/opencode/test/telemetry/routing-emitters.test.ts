/**
 * Feature 047 — routing telemetry emitters.
 *
 * Proves the four domains map onto content-free, allow-listed signals; that
 * emission rides the shipped process-singleton export pipeline non-blockingly;
 * that a failing/absent exporter never breaks routing (hang-safety); that
 * disabled telemetry emits nothing (byte-identical); and that no secret-bearing
 * attribute is ever present. No live collector — an injected transport only.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createMemorySecretPort } from "@/operator/adapters"
import { DEFAULT_TELEMETRY_CONFIG } from "@/routing/application/telemetry-service"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import type { OtlpTransport, TelemetrySignal } from "@/routing/adapters/outbound/otlp-adapter"
import {
  ensureTelemetryExport,
  isTelemetryArmed,
  __resetTelemetryExportForTests,
  type TelemetryExportDeps,
} from "@/routing/telemetry-export"
import {
  routingDecisionSignal,
  budgetConsumptionSignal,
  budgetBreachSignal,
  fanoutAdmissionSignal,
  orchestrationWorkerSignal,
  completionGateSignal,
  emitRoutingDecision,
  emitBudgetConsumption,
  emitFanoutAdmission,
  emitOrchestrationWorker,
  emitCompletionGate,
  orchestrationHandoffSignal,
  emitOrchestrationHandoff,
} from "@/routing/application/telemetry-emitters"

// The CLOSED structural attribute allow-list (mirrors the CUE `#EmissionAttributeKey`).
// `value` is the OTLP metric point primitive, not a semantic label.
const ALLOW_LIST = new Set<string>([
  "value",
  "routing.task_class",
  "routing.routing_profile",
  "routing.hierarchy_role",
  "routing.selected_model",
  "routing.scope",
  "routing.authorized_count",
  "routing.decision_model_called",
  "routing.offline",
  "routing.latency_ms",
  "budget.turns_used",
  "budget.context_tokens_used",
  "budget.output_tokens_used",
  "budget.cost_usd_used",
  "budget.scope",
  "budget.outcome",
  "budget.dimension",
  "hierarchy.parent_role",
  "hierarchy.child_role",
  "hierarchy.fanout_requested",
  "hierarchy.fanout_granted",
  "hierarchy.admitted",
  "hierarchy.denied_reason",
  "orchestration.worker_lifecycle",
  "orchestration.delivery",
  "orchestration.validation",
  "orchestration.fail_action",
  "orchestration.pending_workers",
])

const STUB_CONFIG = {} as ConfigPort

function enabledConfig() {
  return { ...DEFAULT_TELEMETRY_CONFIG, enabled: true, queue: { ...DEFAULT_TELEMETRY_CONFIG.queue, capacity: 64, batch_size: 32 } }
}

/** A no-op scheduler so no background timer fires — the test drives flush manually. */
const NOOP_SCHEDULER = { setInterval: () => 0, clearInterval: () => {} }

function recordingTransport() {
  const sent: TelemetrySignal[][] = []
  const transport: OtlpTransport = {
    async send(batch) {
      sent.push([...batch])
      return { ok: true, reason: null }
    },
    async probe() {
      return { ok: true, reason: null }
    },
  }
  return { transport, sent }
}

/** A transport that always reports failure (a down collector) — never throws. */
function failingTransport(): OtlpTransport {
  return {
    async send() {
      return { ok: false, reason: "collector unreachable" }
    },
    async probe() {
      return { ok: false, reason: "collector unreachable" }
    },
  }
}

function baseDeps(transport: OtlpTransport, enabled: boolean): TelemetryExportDeps {
  return {
    config: STUB_CONFIG,
    secret: createMemorySecretPort(),
    transport,
    resolveConfig: () => Promise.resolve(enabled ? enabledConfig() : DEFAULT_TELEMETRY_CONFIG),
    scheduler: NOOP_SCHEDULER,
  }
}

afterEach(() => {
  __resetTelemetryExportForTests()
})

describe("pure attribute mappers (allow-list + content-free)", () => {
  test("routingDecisionSignal carries only the allow-listed structural scalars", () => {
    const signal = routingDecisionSignal({
      taskClass: "medium",
      routingProfile: "manager",
      hierarchyRole: "architect",
      selectedModel: "anthropic/claude",
      scope: "session",
      authorizedCount: 3,
      decisionModelCalled: false,
      offline: true,
      latencyMs: 12,
    })
    expect(signal.kind).toBe("traces")
    expect(signal.name).toBe("routing.decision")
    for (const key of Object.keys(signal.attributes)) expect(ALLOW_LIST.has(key)).toBe(true)
    expect(signal.attributes["routing.selected_model"]).toBe("anthropic/claude")
    expect(signal.attributes["routing.authorized_count"]).toBe(3)
  })

  test("every domain mapper stays within the allow-list", () => {
    const signals: TelemetrySignal[] = [
      budgetConsumptionSignal({ turnsUsed: 2, contextTokensUsed: 100, outputTokensUsed: 50, costUsdUsed: 0.4, scope: "session" }),
      budgetBreachSignal({ outcome: "blocked", dimension: "max_turns", scope: "session" }),
      fanoutAdmissionSignal({ parentRole: "architect", childRole: "manager", fanoutRequested: 4, fanoutGranted: 2, admitted: true }),
      fanoutAdmissionSignal({ parentRole: "manager", childRole: "worker", fanoutRequested: 3, fanoutGranted: 0, admitted: false, deniedReason: "admission_denied" }),
      orchestrationWorkerSignal({ lifecycle: "failed", delivery: "foreground", validation: "rejected", failAction: "reject_redispatch" }),
      completionGateSignal({ pendingWorkers: 2 }),
    ]
    for (const signal of signals) {
      for (const key of Object.keys(signal.attributes)) expect(ALLOW_LIST.has(key)).toBe(true)
    }
    // The breach counter carries the typed outcome + dimension only.
    expect(signals[1].attributes["budget.outcome"]).toBe("blocked")
    expect(signals[1].attributes["budget.dimension"]).toBe("max_turns")
    // The denied fan-out carries the REAL DispatchRejectionReason enum value.
    expect(signals[3].attributes["hierarchy.denied_reason"]).toBe("admission_denied")
  })

  test("budget.consumption is a span (its per-turn totals would blow up metric cardinality)", () => {
    const signal = budgetConsumptionSignal({ turnsUsed: 3, contextTokensUsed: 900, outputTokensUsed: 300, costUsdUsed: 1.2, scope: "session" })
    expect(signal.kind).toBe("traces")
    expect(signal.attributes.value).toBeUndefined()
    expect(signal.attributes["budget.turns_used"]).toBe(3)
  })

  test("Feature 053 — orchestrationHandoffSignal is content-free (enums/bools/counts only)", () => {
    const signal = orchestrationHandoffSignal({
      synthetic: false,
      eligible: true,
      stages: [
        { stage: "data", result: "ran", durationMs: 12 },
        { stage: "composer", result: "degraded", durationMs: 34 },
      ],
      tally: { repaired: 1, flagged: 2 },
    })
    expect(signal.kind).toBe("traces")
    expect(signal.name).toBe("orchestration.handoff")
    // Every attribute is a bounded enum, boolean, or count — never subtask/brief text.
    for (const value of Object.values(signal.attributes)) {
      if (typeof value === "string") expect(["ran", "degraded", "skipped"]).toContain(value)
      else expect(["boolean", "number"]).toContain(typeof value)
    }
    expect(signal.attributes["orchestration.handoff_data_result"]).toBe("ran")
    expect(signal.attributes["orchestration.handoff_composer_result"]).toBe("degraded")
    expect(signal.attributes["orchestration.handoff_repaired"]).toBe(1)
    expect(signal.attributes["orchestration.handoff_flagged"]).toBe(2)
  })

  test("Feature 053 — emitOrchestrationHandoff is a no-op before any pipeline is composed", () => {
    expect(isTelemetryArmed()).toBe(false)
    expect(() =>
      emitOrchestrationHandoff({ synthetic: false, eligible: false, stages: [] }),
    ).not.toThrow()
  })

  test("an unknown denied reason collapses to a sentinel, never free-form text", () => {
    const signal = fanoutAdmissionSignal({ parentRole: "architect", childRole: "worker", fanoutRequested: 1, fanoutGranted: 0, admitted: false, deniedReason: "the user asked for 4 workers but only 1 fit" })
    expect(signal.attributes["hierarchy.denied_reason"]).toBe("unspecified")
  })

  test("a credential-bearing model id is value-scanned and scrubbed before the wire (FIX 2)", () => {
    const signal = routingDecisionSignal({
      taskClass: "small",
      routingProfile: "direct_worker",
      hierarchyRole: "architect",
      // A self-hosted provider id embedding inline URL creds + a bearer/sk token.
      selectedModel: "https://admin:sk-live-SECRETTOKEN123@host.internal/v1/model Bearer sk-abcdef123456",
      scope: "session",
      authorizedCount: 1,
      decisionModelCalled: false,
      offline: false,
      latencyMs: 1,
    })
    const model = String(signal.attributes["routing.selected_model"])
    expect(model).not.toContain("admin:sk-live")
    expect(model).not.toContain("SECRETTOKEN123")
    expect(model).not.toContain("sk-abcdef123456")
    expect(model).toContain("[redacted]")

    // A structural, non-secret model id passes through UNCHANGED.
    const clean = routingDecisionSignal({
      taskClass: "small",
      routingProfile: "direct_worker",
      hierarchyRole: "architect",
      selectedModel: "openai/gpt-oss-120b",
      scope: "session",
      authorizedCount: 1,
      decisionModelCalled: false,
      offline: false,
      latencyMs: 1,
    })
    expect(clean.attributes["routing.selected_model"]).toBe("openai/gpt-oss-120b")
  })
})

describe("emission over the shipped export pipeline", () => {
  test("each domain emit reaches the transport as a content-free signal", async () => {
    const { transport, sent } = recordingTransport()
    const pipeline = await ensureTelemetryExport(baseDeps(transport, true))
    expect(isTelemetryArmed()).toBe(true)

    emitRoutingDecision({
      taskClass: "small",
      routingProfile: "direct_worker",
      hierarchyRole: "architect",
      // A credential-bearing model id must be scrubbed BEFORE it reaches the wire.
      selectedModel: "https://svc:sk-live-LEAKME99@host/v1/model",
      scope: "session",
      authorizedCount: 1,
      decisionModelCalled: false,
      offline: false,
      latencyMs: 5,
    })
    emitBudgetConsumption(
      { turnsUsed: 1, contextTokensUsed: 10, outputTokensUsed: 5, costUsdUsed: 0.1, scope: "session" },
      { outcome: "blocked", dimension: "cost_usd", scope: "session" },
    )
    emitFanoutAdmission({ parentRole: "architect", childRole: "worker", fanoutRequested: 1, fanoutGranted: 1, admitted: true })
    emitOrchestrationWorker({ lifecycle: "done", delivery: "foreground", validation: "accepted" })
    emitCompletionGate({ pendingWorkers: 1 })

    const out = await pipeline.flush()
    expect(out.flushed).toBeGreaterThanOrEqual(6) // 5 emits + budget breach = 6 domain signals (+ housekeeping)

    const delivered = sent.flat()
    const names = new Set(delivered.map((s) => s.name))
    expect(names.has("routing.decision")).toBe(true)
    expect(names.has("budget.consumption")).toBe(true)
    expect(names.has("budget.breach")).toBe(true)
    expect(names.has("hierarchy.fanout")).toBe(true)
    expect(names.has("orchestration.worker")).toBe(true)
    expect(names.has("orchestration.gate")).toBe(true)

    // No secret/prompt/path substring anywhere on the wire — the inline URL
    // credential embedded in the model id was value-scanned and scrubbed (FIX 2).
    const wire = JSON.stringify(sent)
    expect(wire).not.toContain("sk-live-LEAKME99")
    expect(wire).not.toContain("svc:sk-live")
    expect(wire).not.toContain("/Users/")
    // Only allow-listed attribute keys leave the process.
    for (const signal of delivered.filter((s) => s.name.startsWith("routing.") || s.name.startsWith("budget.") || s.name.startsWith("hierarchy.") || s.name.startsWith("orchestration."))) {
      for (const key of Object.keys(signal.attributes)) expect(ALLOW_LIST.has(key)).toBe(true)
    }
  })

  test("a failing/down exporter never throws on the emit path and drops on flush", async () => {
    const pipeline = await ensureTelemetryExport(baseDeps(failingTransport(), true))
    expect(isTelemetryArmed()).toBe(true)

    // The emit (enqueue) must NEVER throw even with a broken collector — the hot
    // path never touches the network.
    expect(() =>
      emitRoutingDecision({
        taskClass: "large",
        routingProfile: "manager",
        hierarchyRole: "architect",
        selectedModel: "x/y",
        scope: "session",
        authorizedCount: 2,
        decisionModelCalled: true,
        offline: false,
        latencyMs: 9,
      }),
    ).not.toThrow()

    // The background flush swallows the failure: discards, no throw.
    const out = await pipeline.flush()
    expect(out.discarded).toBeGreaterThanOrEqual(1)
    expect(pipeline.status().exportErrorCount).toBeGreaterThanOrEqual(1)
  })

  test("disabled telemetry emits nothing and is byte-identical (no armed pipeline)", async () => {
    const { transport, sent } = recordingTransport()
    const pipeline = await ensureTelemetryExport(baseDeps(transport, false))
    expect(isTelemetryArmed()).toBe(false)
    expect(pipeline.state).toBe("disarmed")

    emitRoutingDecision({
      taskClass: "small",
      routingProfile: "direct_worker",
      hierarchyRole: "architect",
      selectedModel: "x/y",
      scope: "session",
      authorizedCount: 1,
      decisionModelCalled: false,
      offline: false,
      latencyMs: 1,
    })
    emitBudgetConsumption({ turnsUsed: 1, contextTokensUsed: 1, outputTokensUsed: 1, costUsdUsed: 0, scope: "session" })
    emitFanoutAdmission({ parentRole: "architect", childRole: "worker", fanoutRequested: 1, fanoutGranted: 0, admitted: false, deniedReason: "depth_exceeded" })
    emitOrchestrationWorker({ lifecycle: "aborted", delivery: "background", validation: "none" })
    emitCompletionGate({ pendingWorkers: 3 })

    const out = await pipeline.flush()
    expect(out.flushed).toBe(0)
    expect(sent.length).toBe(0)
  })

  test("emit is a no-op before any pipeline is composed (never throws)", () => {
    expect(isTelemetryArmed()).toBe(false)
    expect(() => emitCompletionGate({ pendingWorkers: 1 })).not.toThrow()
  })
})
