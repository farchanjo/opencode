import { describe, expect, test } from "bun:test"
import { SpoolInstruments } from "@opencode-ai/core/outputspool/spool-instruments"

// Feature 005 / T023 (S25) — OutputSpool telemetry instruments. Content-free
// bounded-label metrics; the reasoning channel is never exported to OTEL (C9,
// C22, AC18, AC22).

describe("SpoolInstruments — spans", () => {
  test("exposes the five output.* concept spans", () => {
    expect(Object.values(SpoolInstruments.SpanName)).toEqual([
      "output.append",
      "output.read",
      "output.seal",
      "output.reconcile",
      "output.cleanup",
    ])
  })
  test("correlates with the Feature 001 spans", () => {
    expect(SpoolInstruments.CorrelatedSpanName.sessionExecution).toBe("session.execution")
  })
})

describe("SpoolInstruments — reasoning channel is never exported", () => {
  test("the channel label omits reasoning", () => {
    expect(SpoolInstruments.Labels.channel as readonly string[]).not.toContain("reasoning")
  })
  test("isChannelExportable gates out reasoning", () => {
    expect(SpoolInstruments.isChannelExportable("reasoning")).toBe(false)
    expect(SpoolInstruments.isChannelExportable("stdout")).toBe(true)
    expect(SpoolInstruments.isChannelExportable("nonsense")).toBe(false)
  })
})

describe("SpoolInstruments — bounded label cardinality", () => {
  test("boundEnum collapses an out-of-budget value to OTHER", () => {
    expect(SpoolInstruments.boundEnum(SpoolInstruments.Labels.group_state, "sealed")).toBe("sealed")
    expect(SpoolInstruments.boundEnum(SpoolInstruments.Labels.group_state, "ref_abc123")).toBe(SpoolInstruments.OTHER)
  })
})
