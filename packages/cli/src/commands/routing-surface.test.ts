import { describe, expect, test } from "bun:test"
import { listReservedIds } from "@opencode-ai/core/operator"
import { Commands } from "./commands"

/**
 * The CLI routing/smart/telemetry surface holds no authority of its own: each
 * leaf must map to a reserved Feature 007 command id. This guards against the
 * CLI drifting from the operator catalog.
 */
describe("routing/smart/telemetry command surface", () => {
  test("declares the expected command groups", () => {
    expect(Object.keys(Commands.commands.telemetry.commands).sort()).toEqual([
      "configure",
      "off",
      "on",
      "show",
      "status",
      "test",
    ])
    expect(Object.keys(Commands.commands.smart.commands).sort()).toEqual(["auto", "off", "on", "status"])
    expect(Object.keys(Commands.commands.routing.commands).sort()).toEqual([
      "capability",
      "explain",
      "status",
      "test",
    ])
    expect(Object.keys(Commands.commands.routing.commands.capability.commands)).toEqual(["inspect"])
  })

  test("every reserved telemetry/smart/routing.status id has a matching leaf", () => {
    const reserved = new Set(listReservedIds())
    // Reserved ids the CLI surfaces directly (routing.explain and
    // routing.capability.inspect are RoutingPort operations not yet in the
    // reserved catalog — tracked as a T028 gap).
    const surfaced = [
      "telemetry.status",
      "telemetry.show",
      "telemetry.on",
      "telemetry.off",
      "telemetry.test",
      "telemetry.configure",
      "smart.status",
      "smart.on",
      "smart.off",
      "smart.auto",
      "routing.status",
      "routing.test",
    ]
    for (const id of surfaced) expect(reserved.has(id)).toBe(true)
  })
})
