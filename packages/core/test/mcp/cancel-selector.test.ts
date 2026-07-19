import { describe, expect, test } from "bun:test"
import { CancelSelector } from "@opencode-ai/core/mcp/cancel-selector"

// Feature 008 / T019 (S11) — the cancel wire-path selector: a standard call selects
// notifications/cancelled, a task-augmented call selects tasks/cancel, the root tree
// cancels both, and an unacknowledged remote records the typed outcome (FR17, FR18, C8).

describe("CancelSelector — wire-path selection (FR17, FR18, C8)", () => {
  test("a standard call selects notifications_cancelled", () => {
    expect(CancelSelector.selectWirePath({ requestId: "r1", taskAugmented: false })).toBe("notifications_cancelled")
  })

  test("a task-augmented call selects tasks_cancel", () => {
    expect(CancelSelector.selectWirePath({ requestId: "r2", taskAugmented: true })).toBe("tasks_cancel")
  })

  test("the root tree cancels both classes with the correct path per child", () => {
    const instructions = CancelSelector.selectTree([
      { requestId: "r1", taskAugmented: false },
      { requestId: "r2", taskAugmented: true },
    ])
    expect(instructions).toEqual([
      { requestId: "r1", wirePath: "notifications_cancelled" },
      { requestId: "r2", wirePath: "tasks_cancel" },
    ])
  })
})

describe("CancelSelector — durable cancel outcome (FR17, C8)", () => {
  test("an acknowledged remote settles acknowledged", () => {
    expect(CancelSelector.recordOutcome({ acknowledged: true, remoteKnown: true })).toBe("acknowledged")
  })

  test("an addressable-but-silent remote records cancel_requested", () => {
    expect(CancelSelector.recordOutcome({ acknowledged: false, remoteKnown: true })).toBe("cancel_requested")
  })

  test("an unknown remote records unknown_remote", () => {
    expect(CancelSelector.recordOutcome({ acknowledged: false, remoteKnown: false })).toBe("unknown_remote")
  })
})

describe("CancelSelector — live vs durable event class (C8)", () => {
  test("cancel_requested is live and cancelled is the durable audit", () => {
    expect(CancelSelector.eventClassFor("mcp.call.cancel_requested")).toBe("live")
    expect(CancelSelector.eventClassFor("mcp.call.cancelled")).toBe("durable")
  })
})
