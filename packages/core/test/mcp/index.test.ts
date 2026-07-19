import { describe, expect, test } from "bun:test"
import * as Mcp from "@opencode-ai/core/mcp/index"

// Feature 008 / T023 (S6–S14) — the MCP domain-engine barrel imports without a
// duplicate-export error and re-exports every framework-free module namespace.

describe("Mcp barrel (T023)", () => {
  test("every domain module namespace is re-exported", () => {
    for (const ns of [
      "CancelSelector",
      "CatalogPolicy",
      "ConnectionLifecycle",
      "Degradation",
      "McpInstruments",
      "ReconnectPlanner",
      "ResourcePolicy",
      "SubscriptionMachine",
      "TrustGate",
    ] as const) {
      expect(Mcp).toHaveProperty(ns)
    }
  })

  test("a representative pure entrypoint per module is callable through the barrel", () => {
    expect(Mcp.ConnectionLifecycle.apply("configured", "connect").kind).toBe("transition")
    expect(Mcp.CatalogPolicy.beginWalk()).toBe("walking")
    expect(Mcp.Degradation.classify(Mcp.Degradation.HEALTHY_CONDITIONS).gap).toBe("none")
    expect(Mcp.SubscriptionMachine.deliveryAuthorized("subscribed")).toBe(true)
  })
})
