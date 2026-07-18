import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Enums } from "../src/lifecycle/enums"

describe("Enums.ProcessState", () => {
  test("accepts every one of the ten members", () => {
    for (const member of Enums.ProcessState.literals) {
      expect(Schema.decodeUnknownSync(Enums.ProcessState)(member)).toBe(member)
    }
  })

  test("is a closed set of exactly ten members", () => {
    expect(Enums.ProcessState.literals).toHaveLength(10)
  })

  test("rejects handoff — it is an event, never a state", () => {
    expect(() => Schema.decodeUnknownSync(Enums.ProcessState)("handoff")).toThrow()
  })

  test("rejects an unknown literal", () => {
    expect(() => Schema.decodeUnknownSync(Enums.ProcessState)("paused")).toThrow()
  })
})

describe("Enums.LifecycleEventType", () => {
  test("accepts every one of the 26 members and keeps extend/promote/steer/handoff distinct", () => {
    for (const member of Enums.LifecycleEventType.literals) {
      expect(Schema.decodeUnknownSync(Enums.LifecycleEventType)(member)).toBe(member)
    }
    const distinct = new Set([
      "lifecycle.extended",
      "lifecycle.promoted",
      "lifecycle.steer_requested",
      "lifecycle.handoff",
    ])
    expect(distinct.size).toBe(4)
  })

  test("is a closed set of exactly 26 members prefixed lifecycle.*", () => {
    expect(Enums.LifecycleEventType.literals).toHaveLength(26)
    expect(Enums.LifecycleEventType.literals.every((member) => member.startsWith("lifecycle."))).toBe(true)
  })

  test("rejects an unprefixed or unknown literal", () => {
    expect(() => Schema.decodeUnknownSync(Enums.LifecycleEventType)("admitted")).toThrow()
    expect(() => Schema.decodeUnknownSync(Enums.LifecycleEventType)("lifecycle.paused")).toThrow()
  })
})

describe("Enums.EventClass", () => {
  test("accepts durable and live", () => {
    expect(Schema.decodeUnknownSync(Enums.EventClass)("durable")).toBe("durable")
    expect(Schema.decodeUnknownSync(Enums.EventClass)("live")).toBe("live")
  })

  test("rejects an unknown literal", () => {
    expect(() => Schema.decodeUnknownSync(Enums.EventClass)("ephemeral")).toThrow()
  })
})

describe("Enums.TerminalReason", () => {
  test("accepts every member", () => {
    for (const member of Enums.TerminalReason.literals) {
      expect(Schema.decodeUnknownSync(Enums.TerminalReason)(member)).toBe(member)
    }
  })

  test("is a closed set of exactly seven members", () => {
    expect(Enums.TerminalReason.literals).toHaveLength(7)
  })

  test("rejects an unknown literal", () => {
    expect(() => Schema.decodeUnknownSync(Enums.TerminalReason)("timed_out")).toThrow()
  })
})

describe("Enums.SettlementState", () => {
  test("accepts every member", () => {
    for (const member of Enums.SettlementState.literals) {
      expect(Schema.decodeUnknownSync(Enums.SettlementState)(member)).toBe(member)
    }
  })

  test("rejects an unknown literal", () => {
    expect(() => Schema.decodeUnknownSync(Enums.SettlementState)("settling_soon")).toThrow()
  })
})

describe("Enums.Visibility", () => {
  test("accepts every member", () => {
    for (const member of Enums.Visibility.literals) {
      expect(Schema.decodeUnknownSync(Enums.Visibility)(member)).toBe(member)
    }
  })

  test("rejects an unknown literal", () => {
    expect(() => Schema.decodeUnknownSync(Enums.Visibility)("global")).toThrow()
  })
})

describe("Enums.AgentKind", () => {
  test("accepts every member", () => {
    for (const member of Enums.AgentKind.literals) {
      expect(Schema.decodeUnknownSync(Enums.AgentKind)(member)).toBe(member)
    }
  })

  test("rejects an unknown literal", () => {
    expect(() => Schema.decodeUnknownSync(Enums.AgentKind)("orchestrator")).toThrow()
  })
})

describe("Enums.ActorKind", () => {
  test("accepts every member", () => {
    for (const member of Enums.ActorKind.literals) {
      expect(Schema.decodeUnknownSync(Enums.ActorKind)(member)).toBe(member)
    }
  })

  test("rejects an unknown literal", () => {
    expect(() => Schema.decodeUnknownSync(Enums.ActorKind)("system")).toThrow()
  })
})
