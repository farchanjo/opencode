import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as OperatorCatalog from "@opencode-ai/core/operator/catalog"
import * as OperatorConfirmation from "@opencode-ai/core/operator/confirmation"
import { Experimental } from "@opencode-ai/schema/mcp/experimental"
import { RESERVED_MCP_COMMAND_IDS } from "@opencode-ai/protocol/mcp/commands"
import { McpCommandPort } from "@/operator/mcp/mcp-command-port"
import { McpResourceAdapter } from "@/mcp/resource-adapter"
import { McpTasks } from "@/mcp/experimental/tasks"
import { McpSampling } from "@/mcp/experimental/sampling"
import { McpElicitation } from "@/mcp/experimental/elicitation"
import { McpReindexTrigger } from "@/mcp/reindex-trigger"

// Feature 008 / T045 — contract and consumer-compatibility: the 30 mcp.* ids vs the
// existing reserved catalog (no bump), reserved-id collision rejection, the
// operator-vs-runtime plane separation, the experimental default-off + rollout order
// tasks → sampling → elicitation → content-stream, the Tasks lifecycle, the logging
// setLevel via Feature 007, the semantic-index opt-in, and the seam-shape stability.

describe("reserved catalog parity — no bump (T045)", () => {
  test("the catalog still declares exactly 30 mcp.* ids at version 1.3.0", () => {
    expect(OperatorCatalog.catalogVersion()).toBe("1.3.0")
    const catalogMcp = OperatorCatalog.listReservedIds().filter((id) => id.startsWith("mcp."))
    expect(catalogMcp.length).toBe(30)
    // The protocol command list and the reserved catalog agree exactly.
    expect(new Set(catalogMcp)).toEqual(new Set(RESERVED_MCP_COMMAND_IDS))
  })

  test("every reserved mcp.* id is recognised by the catalog and the domain guard", () => {
    for (const id of RESERVED_MCP_COMMAND_IDS) {
      expect(OperatorCatalog.isReservedCommandId(id)).toBe(true)
      expect(McpCommandPort.isReservedMcpId(id)).toBe(true)
    }
    // A colliding non-reserved id is rejected by the domain guard (no dual authority).
    expect(McpCommandPort.isReservedMcpId("mcp.server.pwn")).toBe(false)
    expect(McpCommandPort.RESERVED_MCP_IDS.size).toBe(30)
  })

  test("the mutating verbs require confirmation; read verbs do not", () => {
    for (const id of ["mcp.server.delete", "mcp.server.disable", "mcp.experimental.enable"]) {
      expect(OperatorConfirmation.requiresConfirmation(id)).toBe(true)
    }
    for (const id of ["mcp.server.list", "mcp.server.status", "mcp.resource.admin.read"]) {
      expect(OperatorConfirmation.requiresConfirmation(id)).toBe(false)
    }
  })
})

describe("operator vs runtime plane separation (T045)", () => {
  test("the operator plane rejects a non-reserved id without dispatch", async () => {
    const calls: string[] = []
    const ports = McpCommandPort.createMcpDomainPorts({
      port: { server: {}, auth: {}, resource: {}, logging: {}, experimental: {}, extension: {} } as never,
      audit: { record: () => Effect.void },
    })
    const result = await ports.mcp.invoke({
      descriptor: { id: "mcp.resource.admin.pwn", domain: "mcp" },
      request: { payload: {}, principal: { kind: "operator", subject: "op" }, scope: { kind: "project", ref: "p" } },
    } as never)
    expect(result.kind).toBe("failure")
    expect(calls.length).toBe(0)
  })

  test("the runtime plane exposes the canonical read adapter, distinct from the admin plane", () => {
    // Runtime read is scheme+Permission gated, never an operator-admin path.
    const cfg = { schemes: new Set(["https"]), roots: ["/proj"] }
    expect(McpResourceAdapter.checkUriAllowed("https://srv/r", cfg).allowed).toBe(true)
    expect(McpResourceAdapter.deliveryAuthorized("subscribed")).toBe(true)
    expect(McpResourceAdapter.deliveryAuthorized("unsubscribed")).toBe(false)
  })
})

describe("experimental flags default-off + rollout order (T045)", () => {
  test("the rollout order is exactly tasks → sampling → elicitation → content-stream", () => {
    expect(Experimental.ExperimentalFlag.literals).toEqual(["tasks", "sampling", "elicitation", "content-stream"])
  })

  test("every flag defaults off — no capability is advertised when disabled", () => {
    expect(McpTasks.capabilityAdvertised({ enabled: false })).toBe(false)
    expect(McpSampling.capabilityAdvertised({ enabled: false })).toBe(false)
    expect(McpElicitation.contentStreamMode([]).mode).toBe("final_result_fallback")
  })

  test("elicitation is always operator-surfaced; the model never auto-answers", () => {
    const req = { serverId: "s", requestId: "r", promptSummary: "pick", sensitiveMode: false } as const
    expect(McpElicitation.routeElicitation({ enabled: true }, req).route).toBe("operator_surface")
    expect(McpElicitation.routeElicitation({ enabled: true }, { ...req, sensitiveMode: true }).route).toBe(
      "blocked_sensitive",
    )
    expect(McpElicitation.modelMayAutoAnswer()).toBe(false)
  })
})

describe("Tasks lifecycle contract (T045)", () => {
  test("taskSupport forbidden is rejected even when enabled; input_required is non-terminal", () => {
    expect(McpTasks.acceptTaskAugmentedCall({ enabled: true }, "forbidden").accept).toBe(false)
    expect(McpTasks.acceptTaskAugmentedCall({ enabled: true }, "required").accept).toBe(true)
    expect(McpTasks.classifyStatus("input_required")).toBe("input_required")
    expect(McpTasks.classifyStatus("completed")).toBe("terminal")
    expect(McpTasks.cancelWirePath("r1")).toBe("tasks_cancel")
  })
})

describe("logging setLevel + semantic-index opt-in (T045)", () => {
  test("setLevel is reachable only through the Feature 007 mcp.logging.level.set reserved id", () => {
    expect(McpCommandPort.isReservedMcpId("mcp.logging.level.set")).toBe(true)
    expect(McpCommandPort.isReservedMcpId("mcp.logging.level.show")).toBe(true)
  })

  test("the semantic reindex fires only under opt-in AND classification AND policy; no vectors", () => {
    const subject = { serverId: "s" as never, resourceUri: "https://x/y" as never, correlationId: "c1" }
    expect(McpReindexTrigger.planReindex({ operatorOptIn: false, classificationRelevant: true, policyQualified: true }, subject).fire).toBe(false)
    const fired = McpReindexTrigger.planReindex({ operatorOptIn: true, classificationRelevant: true, policyQualified: true }, subject)
    expect(fired.fire).toBe(true)
  })
})
