import { describe, expect, test } from "bun:test"
import { ResourcePolicy } from "@opencode-ai/core/mcp/resource-policy"

// Feature 008 / T017 (S9) — the resource-update policy: the default path is
// notify+cache only with no re-read/reindex/wake, a burst is coalesced into the
// bounded queue, and each opt-in step is a distinct gate that never auto-fires
// (FR23, FR24, C9, C21, C22).

describe("ResourcePolicy — notify+cache default with no auto step (FR23, FR24, C9)", () => {
  test("the default policy plans notify + cache only", () => {
    expect(ResourcePolicy.DEFAULT_POLICY).toBe("notify_cache")
    expect(ResourcePolicy.isDefaultPolicy("notify_cache")).toBe(true)
    expect(ResourcePolicy.planSteps("notify_cache")).toEqual(["notify", "cache"])
  })

  test("no policy ever produces an automatic model turn", () => {
    for (const policy of ["notify_cache", "conditional_reread", "reindex", "wake"] as const) {
      expect(ResourcePolicy.planSteps(policy, { wakeAdmitted: true })).not.toContain("turn")
    }
    expect(ResourcePolicy.producesAutomaticTurn()).toBe(false)
  })
})

describe("ResourcePolicy — opt-in gates never auto-fire (C9, C21, C22)", () => {
  test("conditional_reread and reindex add exactly their one rung", () => {
    expect(ResourcePolicy.planSteps("conditional_reread")).toEqual(["notify", "cache", "conditional_reread"])
    expect(ResourcePolicy.planSteps("reindex")).toEqual(["notify", "cache", "reindex"])
  })

  test("wake is admission-gated: it degrades to notify+cache unless admitted", () => {
    expect(ResourcePolicy.planSteps("wake", { wakeAdmitted: false })).toEqual(["notify", "cache"])
    expect(ResourcePolicy.planSteps("wake", { wakeAdmitted: true })).toEqual(["notify", "cache", "wake"])
  })
})

describe("ResourcePolicy — bounded coalescing queue (FR23, FR24, C9)", () => {
  test("a burst of same-URI updates coalesces into one frame with a bumped sequence", () => {
    const queue = ResourcePolicy.createCoalescingQueue({ capacity: 4, debounceMillis: 100 })
    const first = queue.offer({ resourceUri: "res://a", correlationId: "corr-1", nowMillis: 0 })
    expect(first.kind).toBe("queued")
    const second = queue.offer({ resourceUri: "res://a", correlationId: "corr-1", nowMillis: 10 })
    expect(second.kind).toBe("coalesced")
    if (second.kind === "coalesced") {
      expect(second.debounced).toBe(true) // within the 100ms window
      expect(second.frame.count).toBe(2)
      expect(second.frame.coalesced).toBe(true)
    }
    expect(queue.depth()).toBe(1) // deduped to one URI
  })

  test("distinct URIs queue up to capacity then drop queue_full", () => {
    const queue = ResourcePolicy.createCoalescingQueue({ capacity: 2, debounceMillis: 0 })
    expect(queue.offer({ resourceUri: "res://a", correlationId: "c", nowMillis: 0 }).kind).toBe("queued")
    expect(queue.offer({ resourceUri: "res://b", correlationId: "c", nowMillis: 0 }).kind).toBe("queued")
    const dropped = queue.offer({ resourceUri: "res://c", correlationId: "c", nowMillis: 0 })
    expect(dropped).toMatchObject({ kind: "dropped", reason: "queue_full" })
  })

  test("drain returns all pending frames in order and clears the queue", () => {
    const queue = ResourcePolicy.createCoalescingQueue({ capacity: 4, debounceMillis: 0 })
    queue.offer({ resourceUri: "res://a", correlationId: "c", nowMillis: 0 })
    queue.offer({ resourceUri: "res://b", correlationId: "c", nowMillis: 0 })
    const frames = queue.drain()
    expect(frames.map((f) => f.resourceUri)).toEqual(["res://a", "res://b"])
    expect(queue.depth()).toBe(0)
  })
})
