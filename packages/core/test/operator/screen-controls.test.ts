/**
 * Feature 015 T008/T009 — domain-screen control classification (FR7, FR8, FR15).
 * Pins the pure `buildOperatorScreenControls` projection that collapses a domain's
 * on/off (or enable/disable) Configure verb pairs into ONE toggle row and a
 * smart-routing on/off/auto trio into a tri-state row, marks an unavailable
 * backend's control as inert, and leaves per-entity toggles (which select an id)
 * to the collection CRUD screens rather than the domain screen.
 */
import { describe, expect, test } from "bun:test"
import {
  buildOperatorDomainPanel,
  buildOperatorScreenControls,
  OPERATOR_SETTINGS_DOMAINS,
} from "@opencode-ai/core/operator"

describe("Feature 015 T008 — enable/disable pairs collapse into one toggle (FR7)", () => {
  test("telemetry on/off is a single toggle dispatching the opposite verb, marked available", () => {
    const { toggles, tristates, consumedIds } = buildOperatorScreenControls("telemetry")
    expect(tristates).toHaveLength(0)
    expect(toggles).toHaveLength(1)
    const [toggle] = toggles
    expect(toggle.enableId).toBe("telemetry.on")
    expect(toggle.disableId).toBe("telemetry.off")
    expect(toggle.label).toBe("Telemetry")
    expect(toggle.availability).not.toBe("unavailable")
    expect(consumedIds.has("telemetry.on")).toBe(true)
    expect(consumedIds.has("telemetry.off")).toBe(true)
  })

  test("mcp experimental/extension render as two toggles, now real (Feature 017 T008)", () => {
    const { toggles } = buildOperatorScreenControls("mcp")
    const labels = toggles.map((t) => t.label).sort()
    expect(labels).toEqual(["Experimental", "Extension"])
    // Feature 017 T008 flipped the config-backed experimental/extension toggles to
    // commit through the store.config MCP authority, so they are no longer inert.
    for (const toggle of toggles) expect(toggle.availability).not.toBe("unavailable")
  })

  test("per-entity jobs.enable/disable are NOT a domain toggle — they belong to entity CRUD (FR12)", () => {
    const { toggles, tristates, consumedIds } = buildOperatorScreenControls("jobs")
    expect(toggles).toHaveLength(0)
    expect(tristates).toHaveLength(0)
    expect(consumedIds.has("jobs.enable")).toBe(false)
    expect(consumedIds.has("jobs.disable")).toBe(false)
  })
})

describe("Feature 015 T009 — smart routing is a tri-state, never a binary toggle (FR8)", () => {
  test("smart on/off/auto is one tri-state control with the three canonical mode ids", () => {
    const { toggles, tristates } = buildOperatorScreenControls("smart")
    expect(toggles).toHaveLength(0)
    expect(tristates).toHaveLength(1)
    const [tri] = tristates
    expect(tri.label).toBe("Smart")
    expect(tri.availability).not.toBe("unavailable")
    expect(tri.modes.map((m) => [m.state, m.id])).toEqual([
      ["on", "smart.on"],
      ["off", "smart.off"],
      ["auto", "smart.auto"],
    ])
  })
})

describe("Feature 015 T008/T009 — controls partition the Configure verbs (FR7, FR8)", () => {
  test("every consumed id is a Configure verb of its domain, and no verb is consumed twice", () => {
    for (const domain of OPERATOR_SETTINGS_DOMAINS) {
      const configureIds = new Set(buildOperatorDomainPanel(domain).configure.map((v) => v.id))
      const { toggles, tristates, consumedIds } = buildOperatorScreenControls(domain)
      for (const id of consumedIds) expect(configureIds.has(id)).toBe(true)
      const memberIds = [
        ...toggles.flatMap((t) => [t.enableId, t.disableId]),
        ...tristates.flatMap((t) => t.modes.map((m) => m.id)),
      ]
      expect(new Set(memberIds).size).toBe(memberIds.length)
      expect(memberIds.length).toBe(consumedIds.size)
    }
  })
})
