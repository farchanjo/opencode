import { describe, expect, test } from "bun:test"
import { DEFAULT_MAX_POLLS, DEFAULT_POLL_INTERVAL_MS, isTerminalStatus, pollOutcome, resolvePollPlan, statusOf } from "./poll"

describe("process poll", () => {
  test("terminal states are the five absorbing ProcessState members", () => {
    expect(isTerminalStatus("completed")).toBe(true)
    expect(isTerminalStatus("failed")).toBe(true)
    expect(isTerminalStatus("cancelled")).toBe(true)
    expect(isTerminalStatus("zombie")).toBe(true)
    expect(isTerminalStatus("unknown")).toBe(true)
    expect(isTerminalStatus("running")).toBe(false)
    expect(isTerminalStatus(undefined)).toBe(false)
  })

  test("resolvePollPlan falls back to defaults and clamps non-positive input", () => {
    expect(resolvePollPlan(undefined, undefined)).toEqual({
      intervalMs: DEFAULT_POLL_INTERVAL_MS,
      maxPolls: DEFAULT_MAX_POLLS,
    })
    expect(resolvePollPlan(0, -5)).toEqual({ intervalMs: DEFAULT_POLL_INTERVAL_MS, maxPolls: DEFAULT_MAX_POLLS })
    expect(resolvePollPlan(250.9, 3.2)).toEqual({ intervalMs: 250, maxPolls: 3 })
  })

  test("statusOf tolerates both bare and { row } frame shapes", () => {
    expect(statusOf({ status: "running" })).toBe("running")
    expect(statusOf({ row: { status: "queued" } })).toBe("queued")
    expect(statusOf(null)).toBeUndefined()
    expect(statusOf("not-an-object")).toBeUndefined()
  })

  test("pollOutcome stops at terminal state before exhaustion", () => {
    expect(pollOutcome({ status: "completed" }, 5)).toBe("terminal")
    expect(pollOutcome({ status: "running" }, 0)).toBe("exhausted")
    expect(pollOutcome({ status: "running" }, 1)).toBeNull()
  })
})
