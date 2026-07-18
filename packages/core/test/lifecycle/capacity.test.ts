import { describe, expect, test } from "bun:test"
import {
  isSaturated,
  saturationFor,
  SATURATION_REJECT_THRESHOLD,
  UNMEASURED_CAPACITY_SIGNALS,
  worstSaturation,
} from "@opencode-ai/core/lifecycle/admission/capacity"

describe("Capacity (T019)", () => {
  test("UNMEASURED_CAPACITY_SIGNALS is an explicit all-zero baseline, never fabricated", () => {
    expect(UNMEASURED_CAPACITY_SIGNALS).toEqual({
      cpu_saturation: 0,
      mem_saturation: 0,
      provider_saturation: 0,
      sqlite_saturation: 0,
      event_queue_saturation: 0,
      otel_queue_saturation: 0,
    })
  })

  test("worstSaturation returns the highest measured signal", () => {
    const signals = { ...UNMEASURED_CAPACITY_SIGNALS, mem_saturation: 0.4, sqlite_saturation: 0.9 }
    expect(worstSaturation(signals)).toBe(0.9)
  })

  test("saturationFor reads the scope's own signal when one exists", () => {
    const signals = { ...UNMEASURED_CAPACITY_SIGNALS, provider_saturation: 0.7, cpu_saturation: 0.2 }
    expect(saturationFor("provider", signals)).toBe(0.7)
    expect(saturationFor("sqlite", signals)).toBe(0)
  })

  test("saturationFor falls back to the worst signal for scopes with no direct measurement", () => {
    const signals = { ...UNMEASURED_CAPACITY_SIGNALS, event_queue_saturation: 0.8, cpu_saturation: 0.3 }
    expect(saturationFor("session", signals)).toBe(0.8)
    expect(saturationFor("global", signals)).toBe(0.8)
  })

  test("isSaturated gates at/above the reject threshold", () => {
    const belowThreshold = { ...UNMEASURED_CAPACITY_SIGNALS, cpu_saturation: SATURATION_REJECT_THRESHOLD - 0.01 }
    const atThreshold = { ...UNMEASURED_CAPACITY_SIGNALS, cpu_saturation: SATURATION_REJECT_THRESHOLD }
    expect(isSaturated("global", belowThreshold)).toBe(false)
    expect(isSaturated("global", atThreshold)).toBe(true)
  })

  test("isSaturated honors an overridden threshold", () => {
    const signals = { ...UNMEASURED_CAPACITY_SIGNALS, provider_saturation: 0.5 }
    expect(isSaturated("provider", signals, 0.4)).toBe(true)
    expect(isSaturated("provider", signals, 0.6)).toBe(false)
  })
})
