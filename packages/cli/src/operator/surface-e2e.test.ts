/**
 * Feature 001 / T039 — CLI surface end-to-end output.
 *
 * Exercises the real CLI render seam (Output.render, the exact path the routing
 * / smart / telemetry commands emit through) for every surface in BOTH human and
 * JSON modes against redacted operator envelopes, and proves the rendered output
 * is content-free: no prompts, secrets, session ids, or file paths ever reach
 * stdout/stderr. The CLI holds no authority — it only renders the already-redacted
 * operator envelope — so this guards the last mile before a user sees output.
 */
import { describe, expect, test } from "bun:test"
import type { OperatorClientResult } from "@opencode-ai/sdk/operator"
import { Output } from "./output"
import { RoutingRender } from "../routing/render"
import { SmartRender } from "../smart/render"
import { TelemetryRender } from "../telemetry/render"

function ok(id: string, effective: unknown): OperatorClientResult {
  return { ok: true, id, outcome: "success", kind: "operator.admin_result", effective, httpStatus: 200 }
}

function human(fn: (effective: unknown) => string) {
  return (effective: unknown) => fn(effective)
}

// Tokens that must never appear in rendered CLI output regardless of surface.
const FORBIDDEN_OUTPUT = ["sk-", "/Users/", "sess-", "prompt", "secret"]

function assertContentFree(text: string): void {
  for (const token of FORBIDDEN_OUTPUT) {
    expect(text.includes(token), `rendered output leaked "${token}"`).toBe(false)
  }
}

describe("T039 routing surface — human + JSON", () => {
  const effective = {
    enabled: true,
    mode: "auto",
    strictGates: true,
    decisionModelPool: ["m/a"],
    rolePools: { worker: ["m/b"] },
    catalogVersion: "cat-1",
    policyVersion: "pol-1",
    health: "ok",
    reason: null,
    recommendedAction: null,
    offline: false,
  }

  test("human output renders status and stays content-free", () => {
    const out = Output.render(ok("routing.status", effective), false, human(RoutingRender.renderStatus))
    expect(out.exitCode).toBe(0)
    expect(out.stderr).toBe("")
    expect(out.stdout).toContain("routing: enabled (mode auto)")
    expect(out.stdout).toContain("health: ok")
    assertContentFree(out.stdout)
  })

  test("JSON output is the parseable operator envelope only", () => {
    const result = ok("routing.status", effective)
    const out = Output.render(result, true, human(RoutingRender.renderStatus))
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.stdout)
    expect(parsed.kind).toBe("operator.admin_result")
    expect(parsed.id).toBe("routing.status")
    expect(parsed.ok).toBe(true)
    assertContentFree(out.stdout)
  })

  test("routing test always states no external model call was made", () => {
    const testView = {
      taskClass: "small",
      routingProfile: "direct_worker",
      authorizedCandidates: [{ rank: 1, agentId: "a", modelId: "m", score: 1 }],
      noExternalModelCall: true,
      redacted: true,
    }
    const out = Output.render(ok("routing.test", testView), false, human(RoutingRender.renderTest))
    expect(out.stdout).toContain("no external model call was made")
    assertContentFree(out.stdout)
  })
})

describe("T039 smart surface — human + JSON", () => {
  const effective = {
    active: true,
    reason: "routing_active",
    brainActive: true,
    routingActive: true,
    routingProfile: "manager",
    hierarchyRole: "architect",
    indicatorState: { active: true },
    degradedReason: null,
    fallbackText: null,
  }

  test("human output renders the smart state content-free", () => {
    const out = Output.render(ok("smart.status", effective), false, human(SmartRender.renderStatus))
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toContain("smart: active")
    expect(out.stdout).toContain("brain: on  routing: on")
    assertContentFree(out.stdout)
  })

  test("JSON output is the envelope only", () => {
    const out = Output.render(ok("smart.status", effective), true, human(SmartRender.renderStatus))
    const parsed = JSON.parse(out.stdout)
    expect(parsed.id).toBe("smart.status")
    assertContentFree(out.stdout)
  })
})

describe("T039 telemetry surface — human + JSON + redacted secrets", () => {
  // The service returns an already-redacted view: no endpoint secrets, no headers.
  const effective = {
    enabled: true,
    config: {
      endpoint: "http://localhost:4318",
      transport: "http/protobuf",
      signals: { metrics: true, logs: true, traces: true, profiling: false },
      queue: { capacity: 128, batch_size: 32, drop_policy: "drop" },
      redact: { prompts: true, secrets: true, file_paths: true, tool_payloads: true },
    },
    exportHealth: "ok",
    queueDepth: 0,
    queueCapacity: 128,
    dropCount: 0,
    exportErrorCount: 0,
    offline: false,
  }

  test("human output renders telemetry status and redaction flags content-free", () => {
    const out = Output.render(ok("telemetry.status", effective), false, human(TelemetryRender.renderStatus))
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toContain("telemetry: enabled")
    expect(out.stdout).toContain("signals: metrics=on logs=on traces=on profiling=off")
    // The redaction line intentionally names the "prompts"/"secrets" FLAGS, so
    // exclude that structural line before the content-free scan.
    const scanned = out.stdout
      .split("\n")
      .filter((line) => !line.startsWith("redact:"))
      .join("\n")
    assertContentFree(scanned)
  })

  test("JSON output is the parseable envelope only", () => {
    const out = Output.render(ok("telemetry.status", effective), true, human(TelemetryRender.renderStatus))
    const parsed = JSON.parse(out.stdout)
    expect(parsed.id).toBe("telemetry.status")
    expect(parsed.effective.config.transport).toBe("http/protobuf")
  })
})

describe("T039 error envelope rendering", () => {
  const failure: OperatorClientResult = {
    ok: false,
    id: "routing.status",
    outcome: "unavailable",
    kind: "operator.admin_result",
    error: { code: "unavailable", message: "catalog offline", retryable: true },
    httpStatus: 503,
  }

  test("human error goes to stderr with a non-zero exit", () => {
    const out = Output.render(failure, false, human(RoutingRender.renderStatus))
    expect(out.exitCode).toBe(1)
    expect(out.stdout).toBe("")
    expect(out.stderr).toContain("unavailable")
    expect(out.stderr).toContain("catalog offline")
  })

  test("JSON error emits the envelope on stdout with a non-zero exit", () => {
    const out = Output.render(failure, true, human(RoutingRender.renderStatus))
    expect(out.exitCode).toBe(1)
    const parsed = JSON.parse(out.stdout)
    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe("unavailable")
  })
})
