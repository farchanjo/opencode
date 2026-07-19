import { describe, expect, test } from "bun:test"
import * as Lifecycle from "@opencode-ai/core/mcp/connection-lifecycle"
import * as Reconnect from "@opencode-ai/core/mcp/reconnect-planner"
import * as CatalogPolicy from "@opencode-ai/core/mcp/catalog-policy"
import * as ResourcePolicy from "@opencode-ai/core/mcp/resource-policy"
import * as Subscription from "@opencode-ai/core/mcp/subscription-machine"
import * as Cancel from "@opencode-ai/core/mcp/cancel-selector"
import * as Degradation from "@opencode-ai/core/mcp/degradation"
import { McpCatalog } from "@/mcp/catalog"

// Feature 008 / T043 — the lifecycle-fault matrix driven through injected policy
// ports: connect timeouts, needs_auth/needs_client_registration, mid-call disconnect,
// mcp_unavailable typed gap, capability lost on reconnect → session continues; the
// pagination edges (duplicate/non-advancing cursor, max-page, empty catalog,
// list_changed mid-walk); notification storms (bounded queue, coalesce/dedupe/debounce,
// no turn, at most one admission-gated wake); the reconnect/resume path; and the cancel
// wire paths (standard, task, root tree, unacknowledged remote recorded).

describe("lifecycle faults (T043)", () => {
  test("a connect failure reaches failed; the session never crashes", () => {
    const fail = Lifecycle.apply("connecting", "fail")
    expect(fail.kind === "transition" && fail.to).toBe("failed")
    // Terminal states accept no further trigger — illegal, never thrown.
    expect(Lifecycle.apply("failed", "connect").kind).toBe("illegal")
  })

  test("needs_auth and needs_client_registration are additive terminal branches", () => {
    expect(Lifecycle.apply("connecting", "unauthorized").kind === "transition" && Lifecycle.apply("connecting", "unauthorized")).toMatchObject({ to: "needs_auth" })
    const reg = Lifecycle.apply("negotiating", "registration_required")
    expect(reg.kind === "transition" && reg.to).toBe("needs_client_registration")
  })

  test("a mid-call disconnect moves connected → reconnecting", () => {
    const drop = Lifecycle.apply("connected", "drop")
    expect(drop.kind === "transition" && drop.to).toBe("reconnecting")
  })

  test("an unreachable server degrades to a typed mcp_unavailable gap; session continues", () => {
    const outcome = Degradation.classify({ ...Degradation.HEALTHY_CONDITIONS, serverUnreachable: true })
    expect(outcome.gap).toBe("mcp_unavailable")
    expect(outcome.session_continues).toBe(true)
    expect(Degradation.capabilityExercisable(true, outcome.gap)).toBe(false)
  })

  test("a capability lost on reconnect surfaces capabilities_changed, not a crash", () => {
    const prev = { protocol_version: "v1", flags: { "resources.subscribe": true } }
    const next = { protocol_version: "v1", flags: { "resources.subscribe": false } }
    expect(Lifecycle.shouldEmitCapabilitiesChanged(prev, next)).toBe(true)
    expect(Lifecycle.diffCapabilities(prev, next).removed).toContain("resources.subscribe")
  })
})

describe("pagination edges (T043)", () => {
  test("a duplicate/non-advancing cursor trips the guard fail-closed", async () => {
    await expect(
      McpCatalog.paginate(() => Promise.resolve({ items: [1], nextCursor: "same" }), (r) => r.items),
    ).rejects.toThrow(/guard tripped/i)
  })

  test("an unbounded walk trips the max-page bound", async () => {
    let n = 0
    await expect(
      McpCatalog.paginate(() => Promise.resolve({ items: [n], nextCursor: `c${n++}` }), (r) => r.items),
    ).rejects.toThrow(/guard tripped/i)
  })

  test("an empty catalog is a clean fresh walk", async () => {
    const items = await McpCatalog.paginate<number, { items: number[]; nextCursor?: string }>(
      () => Promise.resolve({ items: [] }),
      (r) => r.items,
    )
    expect(items).toEqual([])
  })

  test("the guard classifies a repeated cursor as a duplicate-cursor trip", () => {
    const guard = CatalogPolicy.initialGuard(10)
    const first = CatalogPolicy.nextPage(guard, "c1")
    expect(first.kind).toBe("advance")
    const advanced = first.kind === "advance" ? first.guard : guard
    const repeat = CatalogPolicy.nextPage(advanced, "c1")
    expect(repeat.kind).toBe("guard_tripped")
    expect(repeat.kind === "guard_tripped" && repeat.reason).toBe("duplicate_cursor")
  })

  test("list_changed mid-walk restarts at stale and withholds def replacement", () => {
    expect(CatalogPolicy.onListChanged()).toBe("stale")
    expect(CatalogPolicy.mayReplaceDefs("walking")).toBe(false)
  })
})

describe("notification storms (T043)", () => {
  test("a high-rate burst on one URI coalesces into a single bounded frame", () => {
    const queue = ResourcePolicy.createCoalescingQueue({ capacity: 2, debounceMillis: 50 })
    let outcome = queue.offer({ resourceUri: "u", correlationId: "c", nowMillis: 0 })
    expect(outcome.kind).toBe("queued")
    for (let i = 1; i <= 20; i++) outcome = queue.offer({ resourceUri: "u", correlationId: "c", nowMillis: i })
    expect(outcome.kind).toBe("coalesced")
    if (outcome.kind === "coalesced") {
      expect(outcome.frame.count).toBe(21)
      expect(outcome.debounced).toBe(true)
    }
    expect(queue.depth()).toBe(1)
  })

  test("distinct URIs beyond capacity drop queue_full — the queue stays bounded", () => {
    const queue = ResourcePolicy.createCoalescingQueue({ capacity: 1, debounceMillis: 0 })
    queue.offer({ resourceUri: "a", correlationId: "c", nowMillis: 0 })
    const dropped = queue.offer({ resourceUri: "b", correlationId: "c", nowMillis: 1 })
    expect(dropped.kind).toBe("dropped")
  })

  test("no policy yields a turn; wake fires at most once and only when admitted", () => {
    expect(ResourcePolicy.planSteps("wake", { wakeAdmitted: false })).toEqual(["notify", "cache"])
    expect(ResourcePolicy.planSteps("wake", { wakeAdmitted: true })).toEqual(["notify", "cache", "wake"])
    expect(ResourcePolicy.producesAutomaticTurn()).toBe(false)
  })
})

describe("reconnect/resume path (T043)", () => {
  test("the backoff curve is bounded, monotonic, and capped", () => {
    const cfg = Reconnect.DEFAULT_BACKOFF
    const d0 = Reconnect.cappedDelay(0, cfg)
    const d1 = Reconnect.cappedDelay(1, cfg)
    const dBig = Reconnect.cappedDelay(30, cfg)
    expect(d1).toBeGreaterThanOrEqual(d0)
    expect(dBig).toBe(cfg.capMillis)
  })

  test("at the attempt cap the planner reaches failed", () => {
    const cfg = Reconnect.DEFAULT_BACKOFF
    const decision = Reconnect.planReconnect(cfg.maxAttempts, cfg, 0, { lastEventId: "e", sessionId: "s", resumeSupported: true })
    expect(decision.kind).toBe("failed")
  })

  test("resume is dropped when the server does not support it", () => {
    const decision = Reconnect.planReconnect(0, Reconnect.DEFAULT_BACKOFF, 0, { lastEventId: "e", sessionId: "s", resumeSupported: false })
    expect(decision.kind === "retry" && decision.resume.lastEventId).toBeNull()
  })
})

describe("cancel wire paths (T043)", () => {
  test("standard vs task-augmented calls select the correct wire path", () => {
    expect(Cancel.selectWirePath({ requestId: "r1", taskAugmented: false })).toBe("notifications_cancelled")
    expect(Cancel.selectWirePath({ requestId: "r2", taskAugmented: true })).toBe("tasks_cancel")
  })

  test("a root tree covers both classes with the correct path per child", () => {
    const tree = Cancel.selectTree([
      { requestId: "r1", taskAugmented: false },
      { requestId: "r2", taskAugmented: true },
    ])
    expect(tree).toEqual([
      { requestId: "r1", wirePath: "notifications_cancelled" },
      { requestId: "r2", wirePath: "tasks_cancel" },
    ])
  })

  test("an unacknowledged remote is recorded as the durable audit outcome", () => {
    expect(Cancel.recordOutcome({ acknowledged: true, remoteKnown: true })).toBe("acknowledged")
    expect(Cancel.recordOutcome({ acknowledged: false, remoteKnown: true })).toBe("cancel_requested")
    expect(Cancel.recordOutcome({ acknowledged: false, remoteKnown: false })).toBe("unknown_remote")
    expect(Cancel.eventClassFor("mcp.call.cancel_requested")).toBe("live")
    expect(Cancel.eventClassFor("mcp.call.cancelled")).toBe("durable")
  })

  test("a lost capability fails an active subscription closed; delivery withheld", () => {
    const lost = Subscription.apply("subscribed", "capability_lost")
    expect(lost.kind).toBe("fail_closed")
    expect(Subscription.deliveryAuthorized("fail_closed")).toBe(false)
  })
})
