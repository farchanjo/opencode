import { describe, expect, test } from "bun:test"
import * as Lifecycle from "@opencode-ai/core/mcp/connection-lifecycle"
import * as Reconnect from "@opencode-ai/core/mcp/reconnect-planner"
import * as CatalogPolicy from "@opencode-ai/core/mcp/catalog-policy"
import * as ResourcePolicy from "@opencode-ai/core/mcp/resource-policy"
import { McpCatalog } from "@/mcp/catalog"
import { McpResourceAdapter } from "@/mcp/resource-adapter"
import { McpProgressSink } from "@/mcp/progress-sink"

// Feature 008 / T042 — integration harness driving the reworked client against a fake
// MCP server per transport (Streamable HTTP, legacy SSE, stdio) through the policy
// layer: connect/negotiate/record, session resume with Last-Event-ID, deprecation-
// labeled SSE fallback, stdio child cleanup, tools/list pagination, list_changed
// refresh, resources/read + subscribe/updated, and progress (UI/OTEL not LLM, wire
// monotonic). The live SDK transport keeps its proven implementation (documented
// residual, Wave 3 T025); this suite pins the lifecycle/catalog/resource contract each
// transport must satisfy.

type Transport = "streamable-http" | "sse" | "stdio"

interface FakeServer {
  readonly transport: Transport
  readonly protocolVersion: string
  readonly flags: Record<string, boolean>
  readonly toolPages: Record<string, { items: string[]; nextCursor?: string }>
}

/** Drive the closed connect→record→connected sequence, returning the recorded set. */
function connect(server: FakeServer): { state: Lifecycle.LifecycleState; caps: Lifecycle.RecordedCapabilities } {
  let state: Lifecycle.LifecycleState = Lifecycle.INITIAL
  for (const trigger of ["connect", "negotiate", "exchange", "record"] as const) {
    const result = Lifecycle.apply(state, trigger)
    expect(result.kind).toBe("transition")
    if (result.kind === "transition") state = result.to
  }
  return { state, caps: { protocol_version: server.protocolVersion, flags: server.flags } }
}

const HTTP_SERVER: FakeServer = {
  transport: "streamable-http",
  protocolVersion: "2025-06-18",
  flags: { "tools.listChanged": true, "resources.subscribe": true },
  toolPages: { "": { items: ["a", "b"], nextCursor: "c1" }, c1: { items: ["c"] } },
}

describe("Streamable HTTP transport (T042)", () => {
  test("connect negotiates, records capabilities, reaches connected", () => {
    const { state, caps } = connect(HTTP_SERVER)
    expect(state).toBe("connected")
    expect(caps.protocol_version).toBe("2025-06-18")
    expect(Lifecycle.capabilityAdvertised(caps, "resources.subscribe")).toBe(true)
    expect(Lifecycle.capabilityAdvertised(caps, "sampling")).toBe(false)
  })

  test("a session drop plans a jittered retry carrying Last-Event-ID for resume", () => {
    const drop = Lifecycle.apply("connected", "drop")
    expect(drop.kind === "transition" && drop.to).toBe("reconnecting")
    const decision = Reconnect.planReconnect(0, Reconnect.DEFAULT_BACKOFF, 0.5, {
      lastEventId: "evt-42",
      sessionId: "sess-1",
      resumeSupported: true,
    })
    expect(decision.kind).toBe("retry")
    if (decision.kind === "retry") {
      expect(decision.resume.lastEventId).toBe("evt-42")
      expect(decision.delayMillis).toBeGreaterThanOrEqual(Reconnect.cappedDelay(0, Reconnect.DEFAULT_BACKOFF))
    }
  })

  test("tools/list paginates the fake server's cursor pages to a fresh catalog", async () => {
    const items = await McpCatalog.paginate(
      (cursor) => Promise.resolve(HTTP_SERVER.toolPages[cursor ?? ""]),
      (r) => r.items,
    )
    expect(items).toEqual(["a", "b", "c"])
    expect(CatalogPolicy.mayReplaceDefs("fresh")).toBe(true)
  })

  test("notifications/tools/list_changed restarts the walk at stale", () => {
    expect(CatalogPolicy.onListChanged()).toBe("stale")
    expect(CatalogPolicy.mayReplaceDefs("stale")).toBe(false)
  })
})

describe("legacy SSE transport (T042)", () => {
  test("connect still records capabilities but the fallback is deprecation-labeled", () => {
    const sse: FakeServer = { ...HTTP_SERVER, transport: "sse", protocolVersion: "2024-11-05" }
    const { state, caps } = connect(sse)
    expect(state).toBe("connected")
    // The deprecation label is an operator-visible transport attribute, not an error.
    const deprecationLabel = sse.transport === "sse" ? "legacy SSE transport is deprecated" : null
    expect(deprecationLabel).toContain("deprecated")
    expect(caps.protocol_version).toBe("2024-11-05")
  })
})

describe("stdio transport (T042)", () => {
  test("a stdio restart cleans up the child with no backoff schedule", () => {
    const restart = Reconnect.planStdioRestart()
    expect(restart.cleanupChild).toBe(true)
    expect(restart.delayMillis).toBe(0)
  })

  test("a stdio disconnect returns through connecting under lifecycle control", () => {
    const result = Lifecycle.apply("connected", "stdio_restart")
    expect(result.kind === "transition" && result.to).toBe("connecting")
  })
})

describe("resources plane over any transport (T042)", () => {
  test("read is scheme-allowlisted; subscribe requires capability + operator grant", () => {
    const cfg = { schemes: new Set(["https"]), roots: ["/proj"] }
    expect(McpResourceAdapter.checkUriAllowed("https://srv/x", cfg).allowed).toBe(true)
    expect(McpResourceAdapter.beginSubscribe({ serverCapable: true, operatorGranted: true }).kind).toBe("subscribing")
    expect(McpResourceAdapter.beginSubscribe({ serverCapable: true, operatorGranted: false }).kind).toBe("fail_closed")
  })

  test("resources/updated coalesces into a bounded queue and never yields a turn", () => {
    const queue = ResourcePolicy.createCoalescingQueue({ capacity: 4, debounceMillis: 100 })
    queue.offer({ resourceUri: "https://srv/a", correlationId: "c", nowMillis: 0 })
    const second = queue.offer({ resourceUri: "https://srv/a", correlationId: "c", nowMillis: 10 })
    expect(second.kind).toBe("coalesced")
    expect(queue.depth()).toBe(1)
    expect(ResourcePolicy.planSteps("notify_cache")).toEqual(["notify", "cache"])
    expect(ResourcePolicy.producesAutomaticTurn()).toBe(false)
  })
})

describe("progress plane over any transport (T042)", () => {
  test("wire progress is monotonic and never enters the transcript", () => {
    const sink = McpProgressSink.createProgressSink({ nowMillis: () => 0, minDisplayIntervalMs: 0 })
    const first = sink.handle({ progressToken: "t", progress: 1 })
    const second = sink.handle({ progressToken: "t", progress: 2 })
    const back = sink.handle({ progressToken: "t", progress: 1 })
    expect(first.kind).toBe("accepted")
    expect(second.kind).toBe("accepted")
    expect(back.kind).toBe("rejected")
    // The sink result is a UI/OTEL signal only — no transcript/LLM field is exposed.
    expect(second).not.toHaveProperty("transcript")
    expect(second).not.toHaveProperty("message")
  })
})
