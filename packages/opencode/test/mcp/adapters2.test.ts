import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { McpResourceAdapter } from "@/mcp/resource-adapter"
import { McpSecretBridge } from "@/mcp/secret-bridge"
import { McpReindexTrigger } from "@/mcp/reindex-trigger"
import { McpLoggingBridge } from "@/mcp/logging-bridge"
import { McpTasks } from "@/mcp/experimental/tasks"
import { McpSampling } from "@/mcp/experimental/sampling"
import { McpElicitation } from "@/mcp/experimental/elicitation"
import type { SecretResolvePort } from "@opencode-ai/protocol/mcp/ports"
import type { McpSamplingRequest } from "@opencode-ai/protocol/mcp/commands"

const roots = ["/proj/a"]
const cfg = { schemes: new Set(["https"]), roots }

describe("resource-adapter (T029)", () => {
  test("URI allowlist: https allowed, file confined to roots, other schemes deny-by-default", () => {
    expect(McpResourceAdapter.checkUriAllowed("https://example.com/x", cfg).allowed).toBe(true)
    expect(McpResourceAdapter.checkUriAllowed("file:///proj/a/doc.txt", cfg).allowed).toBe(true)
    const cross = McpResourceAdapter.checkUriAllowed("file:///etc/passwd", cfg)
    expect(cross.allowed).toBe(false)
    const http = McpResourceAdapter.checkUriAllowed("http://169.254.169.254/", cfg)
    expect(http.allowed).toBe(false)
  })

  test("subscribe requires server capability AND operator grant; the LLM never subscribes", () => {
    expect(McpResourceAdapter.beginSubscribe({ serverCapable: true, operatorGranted: true }).kind).toBe("subscribing")
    const noCap = McpResourceAdapter.beginSubscribe({ serverCapable: false, operatorGranted: true })
    expect(noCap.kind).toBe("fail_closed")
    const noGrant = McpResourceAdapter.beginSubscribe({ serverCapable: true, operatorGranted: false })
    expect(noGrant.kind).toBe("fail_closed")
    expect(McpResourceAdapter.deliveryAuthorized("subscribed")).toBe(true)
    expect(McpResourceAdapter.deliveryAuthorized("fail_closed")).toBe(false)
  })

  test("resource_link stays lazy unless policy + permission + budget all gate the fetch", () => {
    expect(McpResourceAdapter.shouldAutoFetchLink({ policyOptIn: false, permitted: true, withinBudget: true })).toBe(false)
    expect(McpResourceAdapter.shouldAutoFetchLink({ policyOptIn: true, permitted: true, withinBudget: true })).toBe(true)
  })
})

describe("secret-bridge (T030)", () => {
  test("one-time migration mints an opaque ref per token-bearing entry, never plaintext", () => {
    const port: SecretResolvePort = { resolve: () => Effect.succeed({ handle: "h" }) }
    const bridge = McpSecretBridge.createSecretBridge({ secrets: port })
    const refs = bridge.migrateLegacyEntries([{ server: "gh", hasTokens: true }, { server: "empty", hasTokens: false }])
    expect(refs).toEqual([{ server: "gh", secretRef: "mcp/oauth/gh" }])
    expect(JSON.stringify(refs)).not.toContain("token")
  })
})

describe("reindex-trigger (T035)", () => {
  const subject = { serverId: "s" as any, resourceUri: "https://x/y" as any, correlationId: "c1" }
  test("fires exactly once only under opt-in AND classification AND policy; no vectors", () => {
    expect(McpReindexTrigger.planReindex({ operatorOptIn: false, classificationRelevant: true, policyQualified: true }, subject).fire).toBe(false)
    expect(McpReindexTrigger.planReindex({ operatorOptIn: true, classificationRelevant: false, policyQualified: true }, subject).fire).toBe(false)
    const fired = McpReindexTrigger.planReindex({ operatorOptIn: true, classificationRelevant: true, policyQualified: true }, subject)
    expect(fired.fire).toBe(true)
    if (fired.fire) expect(fired.trigger.correlationId).toBe("c1")
  })
})

describe("logging-bridge (T036)", () => {
  test("redacts secret-shaped keys and path-shaped values; rate-limits per window", () => {
    const bridge = McpLoggingBridge.createLoggingBridge({ nowMillis: () => 0, maxPerWindow: 2, windowMs: 1000 })
    const d1 = bridge.ingest({ server: "s", level: "info", data: { token: "abc", file: "/etc/x", note: "ok" } })
    expect(d1.emit).toBe(true)
    if (d1.emit) {
      const data = d1.fields.data as Record<string, unknown>
      expect(data.token).toBe("[redacted]")
      expect(data.file).toBe("[path]")
      expect(data.note).toBe("ok")
    }
    bridge.ingest({ server: "s", level: "info" })
    const d3 = bridge.ingest({ server: "s", level: "info" })
    expect(d3.emit).toBe(false) // rate-limited (3rd in window)
  })
})

describe("experimental tasks (T031)", () => {
  test("default-off advertises no tasks capability and rejects task-augmented calls", () => {
    expect(McpTasks.capabilityAdvertised({ enabled: false })).toBe(false)
    expect(McpTasks.acceptTaskAugmentedCall({ enabled: false }, "optional").accept).toBe(false)
  })
  test("enabled accepts optional/required but rejects forbidden; cancel uses tasks_cancel", () => {
    expect(McpTasks.acceptTaskAugmentedCall({ enabled: true }, "optional").accept).toBe(true)
    const forbidden = McpTasks.acceptTaskAugmentedCall({ enabled: true }, "forbidden")
    expect(forbidden.accept).toBe(false)
    expect(McpTasks.classifyStatus("input_required")).toBe("input_required")
    expect(McpTasks.classifyStatus("completed")).toBe("terminal")
    expect(McpTasks.cancelWirePath("r1")).toBe("tasks_cancel")
  })
})

function samplingReq(): McpSamplingRequest {
  return { serverId: "s", requestId: "r", agentId: "a", modelRef: "m" }
}

describe("experimental sampling (T032)", () => {
  test("default-off does not advertise and returns flag_disabled", async () => {
    const adapter = McpSampling.createSamplingAdapter({
      config: { enabled: false },
      checkPermission: () => Effect.succeed(true),
      audit: () => Effect.void,
    })
    const exit = await Effect.runPromiseExit(adapter.request(samplingReq()))
    expect(Exit.isFailure(exit)).toBe(true)
  })
  test("enabled but unpermitted fails closed; permitted routes through the session-runtime seam", async () => {
    let sessionCalls = 0
    const adapter = McpSampling.createSamplingAdapter({
      config: { enabled: true },
      checkPermission: () => Effect.succeed(true),
      sessionRuntime: () => {
        sessionCalls++
        return Effect.succeed({ decision: "approved", auditId: "aud" })
      },
      audit: () => Effect.void,
    })
    const result = await Effect.runPromise(adapter.request(samplingReq()))
    expect(result.decision).toBe("approved")
    expect(sessionCalls).toBe(1)

    const denied = McpSampling.createSamplingAdapter({
      config: { enabled: true },
      checkPermission: () => Effect.succeed(false),
      audit: () => Effect.void,
    })
    expect(Exit.isFailure(await Effect.runPromiseExit(denied.request(samplingReq())))).toBe(true)
  })
  test("unwired session-runtime seam degrades to unavailable, never a bypass", async () => {
    const adapter = McpSampling.createSamplingAdapter({
      config: { enabled: true },
      checkPermission: () => Effect.succeed(true),
      audit: () => Effect.void,
    })
    expect(Exit.isFailure(await Effect.runPromiseExit(adapter.request(samplingReq())))).toBe(true)
  })
})

describe("experimental elicitation (T033)", () => {
  test("always operator-surfaced; sensitive mode blocks; model never auto-answers", () => {
    const req = { serverId: "s", requestId: "r", promptSummary: "pick", sensitiveMode: false } as const
    expect(McpElicitation.routeElicitation({ enabled: true }, req).route).toBe("operator_surface")
    expect(McpElicitation.routeElicitation({ enabled: true }, { ...req, sensitiveMode: true }).route).toBe("blocked_sensitive")
    expect(McpElicitation.modelMayAutoAnswer()).toBe(false)
  })
  test("content-stream advertises only under the namespaced capability with a final-result fallback", () => {
    expect(McpElicitation.contentStreamMode([]).mode).toBe("final_result_fallback")
    expect(McpElicitation.contentStreamMode(["experimental/opencode.contentStream"]).mode).toBe("content_stream")
  })
})
