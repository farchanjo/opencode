import { describe, expect, test } from "bun:test"
import { ConnectionLifecycle } from "@opencode-ai/core/mcp/connection-lifecycle"

// Feature 008 / T014 (S6) — the connection-lifecycle machine: every legal
// transition, rejected illegal transitions, the recorded capability set captured at
// `recording`, and a reconnect diff emitting `capabilities_changed` (FR7, FR8, C2).

describe("ConnectionLifecycle — legal transitions (C2)", () => {
  test("the happy path configured → connecting → negotiating → recording → connected", () => {
    let state: ConnectionLifecycle.LifecycleState = ConnectionLifecycle.INITIAL
    for (const trigger of ["connect", "negotiate", "exchange", "record"] as const) {
      const result = ConnectionLifecycle.apply(state, trigger)
      expect(result.kind).toBe("transition")
      if (result.kind === "transition") state = result.to
    }
    expect(state).toBe("connected")
  })

  test("terminal branches are reachable from their statechart sources", () => {
    expect(ConnectionLifecycle.apply("connecting", "unauthorized")).toMatchObject({ to: "needs_auth" })
    expect(ConnectionLifecycle.apply("negotiating", "registration_required")).toMatchObject({
      to: "needs_client_registration",
    })
    expect(ConnectionLifecycle.apply("connected", "disable")).toMatchObject({ to: "disabled" })
    expect(ConnectionLifecycle.apply("connected", "fail")).toMatchObject({ to: "failed" })
  })

  test("a Streamable HTTP drop reconnects through negotiating and caps to failed", () => {
    expect(ConnectionLifecycle.apply("connected", "drop")).toMatchObject({ to: "reconnecting" })
    expect(ConnectionLifecycle.apply("reconnecting", "resume")).toMatchObject({ to: "negotiating" })
    expect(ConnectionLifecycle.apply("reconnecting", "max_attempts")).toMatchObject({ to: "failed" })
  })

  test("a stdio restart returns connected → connecting with no backoff edge", () => {
    expect(ConnectionLifecycle.apply("connected", "stdio_restart")).toMatchObject({ to: "connecting" })
  })
})

describe("ConnectionLifecycle — illegal transitions rejected (C2)", () => {
  test("an out-of-order trigger is illegal, never thrown", () => {
    expect(ConnectionLifecycle.apply("configured", "record").kind).toBe("illegal")
    expect(ConnectionLifecycle.apply("connected", "connect").kind).toBe("illegal")
  })

  test("a terminal branch accepts no further trigger", () => {
    for (const terminal of ConnectionLifecycle.TERMINAL_BRANCHES) {
      expect(ConnectionLifecycle.isTerminal(terminal)).toBe(true)
      expect(ConnectionLifecycle.apply(terminal, "connect").kind).toBe("illegal")
    }
  })
})

describe("ConnectionLifecycle — recorded capability set + reconnect diff (FR7, FR8, C2)", () => {
  const recorded: ConnectionLifecycle.RecordedCapabilities = {
    protocol_version: "2025-06-18",
    flags: { "resources.subscribe": true, "tools.listChanged": true, sampling: false },
  }

  test("an unadvertised capability is never exercisable", () => {
    expect(ConnectionLifecycle.capabilityAdvertised(recorded, "resources.subscribe")).toBe(true)
    expect(ConnectionLifecycle.capabilityAdvertised(recorded, "sampling")).toBe(false)
    expect(ConnectionLifecycle.capabilityAdvertised(recorded, "never_advertised")).toBe(false)
  })

  test("an identical re-record emits no capabilities_changed", () => {
    expect(ConnectionLifecycle.shouldEmitCapabilitiesChanged(recorded, { ...recorded })).toBe(false)
  })

  test("a reconnect diff emits capabilities_changed on an added/removed/changed flag", () => {
    const next: ConnectionLifecycle.RecordedCapabilities = {
      protocol_version: "2025-06-18",
      flags: { "resources.subscribe": true, "tools.listChanged": true, sampling: true, logging: true },
    }
    const diff = ConnectionLifecycle.diffCapabilities(recorded, next)
    expect(diff.added).toContain("logging")
    expect(diff.added).toContain("sampling") // false → true is newly advertised
    expect(ConnectionLifecycle.shouldEmitCapabilitiesChanged(recorded, next)).toBe(true)
  })

  test("a protocol-version change alone emits capabilities_changed", () => {
    const bumped = { ...recorded, protocol_version: "2025-11-25" }
    expect(ConnectionLifecycle.diffCapabilities(recorded, bumped).protocol_changed).toBe(true)
    expect(ConnectionLifecycle.shouldEmitCapabilitiesChanged(recorded, bumped)).toBe(true)
  })
})
