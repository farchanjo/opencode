/**
 * Feature 003 / T033 — notification-service integration (AC7, AC8, AC9, AC29).
 *
 * Bounded async delivery over the Feature 002 observation seam: enqueue,
 * safe-active-turn-boundary delivery (queue on an unsafe/busy turn without
 * interrupting unsafe work, AC7), acknowledgement, TTL expiry (AC8), bounded
 * per-scope queue overflow (coalesce-then-expire, AC8/AC21), cross-scope-leak
 * rejection on directed ack (AC9), and the bounded-summary/opaque-OutputRef
 * envelope boundary (AC29). Every event rides one injected publisher — no second
 * channel. Mirrors `test/lifecycle` style.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { createNotificationService } from "@/jobs/notification-service"
import type { NotificationEnqueueInput, NotificationTargetPrincipal } from "@opencode-ai/protocol/jobs/commands"
import { fakePublisher } from "./fixtures"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

const MAIN: NotificationTargetPrincipal = { kind: "main-context", rootSessionId: "ses_root" }

function idGen(prefix = "ntf"): () => string {
  let n = 0
  return () => `${prefix}_${n++}`
}

function build(over: { queueCapacity?: number; clock?: () => number } = {}) {
  const { publisher, published } = fakePublisher()
  const service = createNotificationService({
    publisher,
    subscribe: Effect.succeed(Stream.empty),
    clock: over.clock ?? (() => 1_721_260_800_000),
    newNotificationId: idGen(),
    queueCapacity: over.queueCapacity,
  })
  return { service, published }
}

function enqueueInput(over: Partial<NotificationEnqueueInput> = {}): NotificationEnqueueInput {
  return {
    occurrenceId: "occ_1",
    jobDefinitionId: "job_test_1",
    type: "occurrence_completed",
    target: MAIN,
    summary: "reindex complete",
    outputRef: { ref: "output_ref_1" },
    ttlSeconds: 60,
    ...over,
  }
}

const publishedTypes = (published: { eventType: string }[]): string[] => published.map((p) => p.eventType)

describe("T033 notification service — enqueue + safe-boundary delivery (AC7)", () => {
  test("a safe active-turn boundary delivers and events the delivery", async () => {
    const { service, published } = build()
    const { envelope } = await run(service.enqueue(enqueueInput()))
    expect(envelope.deliveryState).toBe("pending")
    // The envelope carries a bounded summary + opaque OutputRef only, never content/paths (AC29).
    expect(envelope.summary).toBe("reindex complete")
    expect(envelope.outputRef).toEqual({ ref: "output_ref_1" })

    const out = await run(service.deliverAtBoundary({ notificationId: envelope.notificationId, targetSafeBoundary: true }))
    expect(out.deliveryState).toBe("delivered")
    expect(publishedTypes(published)).toEqual(["job.notification_enqueued", "job.notification_delivered"])
  })

  test("an unsafe/busy turn queues without interrupting unsafe work (AC7)", async () => {
    const { service, published } = build()
    const { envelope } = await run(service.enqueue(enqueueInput()))
    const out = await run(service.deliverAtBoundary({ notificationId: envelope.notificationId, targetSafeBoundary: false }))
    expect(out.deliveryState).toBe("queued")
    // No delivered event was published — unsafe work was never interrupted.
    expect(publishedTypes(published)).not.toContain("job.notification_delivered")
  })
})

describe("T033 notification service — acknowledgement", () => {
  test("the authorized main-context principal acknowledges and events the ack", async () => {
    const { service, published } = build()
    const { envelope } = await run(service.enqueue(enqueueInput()))
    const out = await run(service.ack({ notificationId: envelope.notificationId, principal: MAIN }))
    expect(out.ackState).toBe("acknowledged")
    expect(publishedTypes(published)).toContain("job.notification_acknowledged")
  })

  test("a cross-scope principal ack is rejected, never a silent drop (AC9)", async () => {
    const { service } = build()
    const { envelope } = await run(service.enqueue(enqueueInput()))
    const foreign: NotificationTargetPrincipal = { kind: "agent", sessionId: "ses_other" }
    const exit = await Effect.runPromiseExit(service.ack({ notificationId: envelope.notificationId, principal: foreign }))
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const err = exit.cause.toJSON() as { _tag: string }
      expect(JSON.stringify(err)).toContain("cross_scope_leak_rejected")
    }
  })
})

describe("T033 notification service — TTL expiry and bounded queues (AC8)", () => {
  test("expire records expiry and the ack afterward no longer applies", async () => {
    const { service, published } = build()
    const { envelope } = await run(service.enqueue(enqueueInput()))
    const expired = await run(service.expire({ notificationId: envelope.notificationId }))
    expect(expired.deliveryState).toBe("expired")
    expect(publishedTypes(published)).toContain("job.notification_expired")

    const ack = await run(service.ack({ notificationId: envelope.notificationId, principal: MAIN }))
    expect(ack.ackState).toBe("not_applicable")
  })

  test("a bounded per-scope queue coalesce-then-expires the oldest on overflow (AC8, AC21)", async () => {
    const { service, published } = build({ queueCapacity: 1 })
    await run(service.enqueue(enqueueInput({ occurrenceId: "occ_1" })))
    await run(service.enqueue(enqueueInput({ occurrenceId: "occ_2" })))
    // The second enqueue expired the first (capacity 1) — the queue never grows unbounded.
    expect(publishedTypes(published)).toContain("job.notification_expired")
  })

  test("delivering an already-expired notification is idempotent, never re-delivered", async () => {
    const { service } = build()
    const { envelope } = await run(service.enqueue(enqueueInput()))
    await run(service.expire({ notificationId: envelope.notificationId }))
    const out = await run(service.deliverAtBoundary({ notificationId: envelope.notificationId, targetSafeBoundary: true }))
    expect(out.deliveryState).toBe("expired")
  })
})

describe("T033 notification service — invalid action rejected (FR24)", () => {
  test("a raw prompt injection is never a valid notification action", async () => {
    const { service } = build()
    const { envelope } = await run(service.enqueue(enqueueInput()))
    const exit = await Effect.runPromiseExit(
      service.audit({ notificationId: envelope.notificationId, action: "raw_prompt" as never, principal: { kind: "operator", id: "op_1" }, reason: null }),
    )
    expect(exit._tag).toBe("Failure")
  })

  test("an explicit operator action audits with a bounded audit id", async () => {
    const { service } = build()
    const { envelope } = await run(service.enqueue(enqueueInput()))
    const out = await run(
      service.audit({ notificationId: envelope.notificationId, action: "manager_wake", principal: { kind: "operator", id: "op_1" }, reason: "safe boundary reached" }),
    )
    expect(out.auditId).toContain(envelope.notificationId)
  })
})

describe("T033 notification service — scoped observation redaction (AC9)", () => {
  test("an agent observing a sibling session is an eager cross-scope leak rejection", async () => {
    const { service } = build()
    const agent: NotificationTargetPrincipal = { kind: "agent", sessionId: "ses_self" }
    const exit = await Effect.runPromiseExit(
      Effect.scoped(service.observe({ principal: agent, scope: "session", scopeId: "ses_other" })),
    )
    expect(exit._tag).toBe("Failure")
  })

  test("the main-context principal observes its own root tree", async () => {
    const { service } = build()
    const stream = await run(Effect.scoped(service.observe({ principal: MAIN, scope: "root", scopeId: "ses_root" })))
    expect(stream).toBeDefined()
  })
})
