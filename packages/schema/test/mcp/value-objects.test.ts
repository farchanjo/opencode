import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Capability } from "../../src/mcp/capability"
import { EventsCall } from "../../src/mcp/events-call"
import { EventsLive } from "../../src/mcp/events-live"
import { EventsLog } from "../../src/mcp/events-log"
import { EventsResource } from "../../src/mcp/events-resource"
import { EventsServer } from "../../src/mcp/events-server"
import { Experimental } from "../../src/mcp/experimental"
import { Policy } from "../../src/mcp/policy"
import { SpoolDescriptor } from "../../src/mcp/spool-descriptor"

// Feature 008 / T041 — pin the recorded-capability, policy/trust, experimental and
// spool value objects, and assert envelope/detail redaction: no member carries a body,
// URI-as-content, secret, token, or filesystem path (FR32, FR33, FR38, C16, C26).

// Exact-key blacklist — a content-free control-plane event never exposes any of these.
const FORBIDDEN_KEYS = new Set([
  "content",
  "body",
  "data",
  "secret",
  "token",
  "password",
  "path",
  "file_path",
  "filepath",
  "raw",
  "plaintext",
  "header_value",
  "bytes",
  "blob",
])

function collectFieldKeys(schema: unknown, acc: Set<string>): void {
  const fields = (schema as { fields?: Record<string, unknown> })?.fields
  if (!fields) return
  for (const [key, value] of Object.entries(fields)) {
    acc.add(key)
    collectFieldKeys(value, acc)
  }
}

const MEMBER_STRUCTS = [
  EventsServer.McpServerStatusEvent,
  EventsServer.McpCapabilitiesChangedEvent,
  EventsServer.McpToolsChangedEvent,
  EventsServer.McpResourcesChangedEvent,
  EventsResource.McpResourceUpdatedEvent,
  EventsResource.McpSubscriptionSubscribedEvent,
  EventsResource.McpSubscriptionUnsubscribedEvent,
  EventsCall.McpCallSettledEvent,
  EventsCall.McpCallCancelledEvent,
  EventsCall.McpTaskSettledEvent,
  EventsLive.McpCallStartedEvent,
  EventsLive.McpCallProgressEvent,
  EventsLive.McpCallCancelRequestedEvent,
  EventsLog.McpTaskStatusEvent,
  EventsLog.McpLogEvent,
]

describe("event redaction (T041)", () => {
  test("no event member exposes a body/content/secret/token/path field", () => {
    for (const member of MEMBER_STRUCTS) {
      const keys = new Set<string>()
      collectFieldKeys(member, keys)
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys.has(forbidden)).toBe(false)
      }
      // Every member is carried by the content-free envelope.
      expect(keys.has("envelope")).toBe(true)
    }
  })

  test("call settlement carries OutputRef + byte length, never a body", () => {
    const keys = new Set<string>()
    collectFieldKeys(EventsCall.McpCallSettledEvent, keys)
    expect(keys.has("output_ref")).toBe(true)
    expect(keys.has("byte_length")).toBe(true)
    expect(keys.has("content")).toBe(false)
  })
})

describe("NegotiatedCapabilities value object (T041)", () => {
  test("records the negotiated protocol version and every capability flag", () => {
    const decoded = Schema.decodeUnknownSync(Capability.NegotiatedCapabilities)({
      protocol_version: "2025-06-18",
      tools: { list_changed: true },
      resources: { subscribe: true, list_changed: false },
      prompts: { list_changed: false },
      logging: { set_level: true },
      experimental: { tasks: false, sampling: false, elicitation: false, content_stream: false },
      recorded_at: 1_700_000_000_000,
    })
    expect(decoded.protocol_version).toBe("2025-06-18")
    expect(decoded.resources.subscribe).toBe(true)
    expect(decoded.experimental.tasks).toBe(false)
  })
})

describe("policy/trust flag defaults (T041)", () => {
  test("annotation hint and policy opt-in are booleans defaulting off in usage", () => {
    // The flags are boolean VOs; the default-off posture is enforced by the engines
    // (T017/T021). Here we pin that the hint is representable and distinct from Capable.
    expect(Schema.decodeUnknownSync(Policy.Hint)(false)).toBe(false)
    expect(Schema.decodeUnknownSync(Policy.PolicyOptin)(false)).toBe(false)
    expect(() => Schema.decodeUnknownSync(Policy.Hint)("yes")).toThrow()
  })
})

describe("experimental flag set (T041)", () => {
  test("is per-server, four-membered, with the reserved content-stream capability string", () => {
    expect(Experimental.ExperimentalFlag.literals).toEqual(["tasks", "sampling", "elicitation", "content-stream"])
    expect(Schema.decodeUnknownSync(Experimental.ContentStreamCapability)("experimental/opencode.contentStream")).toBe(
      "experimental/opencode.contentStream",
    )
    expect(() => Schema.decodeUnknownSync(Experimental.ContentStreamCapability)("experimental/other")).toThrow()
  })
})

describe("spool descriptors (T041)", () => {
  test("McpCallOutput/McpReadOutput carry preview + OutputRef + byte length, never a path", () => {
    for (const descriptor of [SpoolDescriptor.McpCallOutput, SpoolDescriptor.McpReadOutput]) {
      const keys = new Set<string>()
      collectFieldKeys(descriptor, keys)
      expect(keys.has("preview")).toBe(true)
      expect(keys.has("output_ref")).toBe(true)
      expect(keys.has("byte_length")).toBe(true)
      expect(keys.has("path")).toBe(false)
      expect(keys.has("file_path")).toBe(false)
    }
  })
})
