/**
 * T024 review — durable outbox atomic intent, reconcile lease, bounded list, prune.
 * Uses durable Config store + memory EventPort (and optional SQL prune unit via mock).
 */
import { describe, expect, test } from "bun:test"
import {
  createMemoryEventPort,
  createMemoryOutboxPort,
  createMemoryConfigPort,
  createDurableOperatorStore,
  createFakeConfigService,
  stableOperatorAuditEventIdFromRecord,
} from "@/operator/adapters"
import { createProcessMutexLockPort } from "@/operator/application"
import {
  reconcileOperatorAuditOutbox,
  runOperatorAuditMaintenance,
  startOperatorAuditMaintenance,
} from "@/operator/application/audit-reconcile"
import {
  AUDIT_RETENTION_DAYS,
  auditRetentionMs,
  operatorAuditAggregateID,
  type AuditRecord,
} from "@opencode-ai/core/operator"
import type { EventPort } from "@/operator/application/ports/event-port"
import { mutateAuthority } from "@/operator/application/mutation"
import type { CommandRequest } from "@opencode-ai/core/operator"

function sampleRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    source: "cli",
    actorRef: "operator:local",
    scope: { kind: "project", ref: "p1" },
    commandId: "langlock.set",
    beforeVersion: null,
    afterVersion: "cas_v1",
    outcome: "success",
    createdAtMs: 1_700_000_000_000,
    ...overrides,
  }
}

function req(overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    id: "langlock.set" as CommandRequest["id"],
    principal: { kind: "operator", subject: "local", projectBinding: "p1" },
    scope: { kind: "project", ref: "p1" },
    source: "cli",
    isTty: false,
    confirm: true,
    idempotencyKey: `k_${Math.random().toString(36).slice(2)}`,
    ...overrides,
  }
}

describe("T024 constants", () => {
  test("90 day retention", () => {
    expect(AUDIT_RETENTION_DAYS).toBe(90)
    expect(operatorAuditAggregateID("abc")).toBe("operator:abc")
  })

  test("stable id hashes full record", () => {
    const a = sampleRecord()
    const b = { ...a, outcome: "conflict" as const }
    expect(stableOperatorAuditEventIdFromRecord(a)).not.toBe(stableOperatorAuditEventIdFromRecord(b))
    expect(stableOperatorAuditEventIdFromRecord(a)).toBe(stableOperatorAuditEventIdFromRecord(a))
    expect(stableOperatorAuditEventIdFromRecord(a).startsWith("evt_")).toBe(true)
  })
})

describe("T024 atomic CAS + audit intent", () => {
  test("failpoint after Config commit leaves authority and intent together", async () => {
    const fake = createFakeConfigService()
    const lock = createProcessMutexLockPort()
    const failing = createDurableOperatorStore({
      config: fake,
      lock,
      afterWrite: () => {
        throw new Error("crash after commit")
      },
    })
    const cas = await failing.config.compareAndSet({
      authority: "langlock",
      expectedVersion: null,
      payload: { enabled: true },
      nowMs: 1_700_000_000_000,
      auditIntent: {
        record: {
          source: "cli",
          actorRef: "operator:local",
          scope: { kind: "project", ref: "p1" },
          commandId: "langlock.set",
          beforeVersion: null,
          outcome: "success",
          createdAtMs: 1_700_000_000_000,
        },
        projectKey: "p1",
      },
    })
    expect(cas.ok).toBe(false)

    const restarted = createDurableOperatorStore({ config: fake, lock, projectKey: "p1" })
    expect((await restarted.config.get("langlock"))?.payload).toEqual({ enabled: true })
    expect((await restarted.outbox.listPending()).length).toBe(1)
  })

  test("CAS writes outbox intent in same document; publish fail → audit_pending", async () => {
    const fake = createFakeConfigService()
    const lock = createProcessMutexLockPort()
    const store = createDurableOperatorStore({ config: fake, lock, projectKey: "p1" })
    let fail = true
    const events: EventPort = {
      async appendAudit() {
        if (fail) return { ok: false, code: "unavailable", reason: "down" }
        return { ok: true, auditId: "evt_ok" }
      },
      async listAudits() {
        return []
      },
      async pruneAudits() {
        return 0
      },
    }
    const r = await mutateAuthority(
      {
        config: store.config,
        idempotency: store.idempotency,
        events,
        outbox: store.outbox,
        requireAudit: true,
        nowMs: () => 1_700_000_000_000,
      },
      {
        request: req(),
        authority: "langlock",
        apply: () => ({ enabled: true }),
      },
    )
    expect(r.outcome).toBe("audit_pending")
    expect(r.version).toBeTruthy()
    const pending = await store.outbox.listPending()
    expect(pending.length).toBe(1)
    expect(pending[0]!.body).toBeTruthy()
    // Restart: same config
    const store2 = createDurableOperatorStore({ config: fake, lock, projectKey: "p1" })
    expect((await store2.outbox.listPending()).length).toBe(1)
    fail = false
    const rec = await reconcileOperatorAuditOutbox({ outbox: store2.outbox, events })
    expect(rec.delivered).toBe(1)
    expect((await store2.outbox.listPending()).length).toBe(0)
  })

  test("successful publish acks intent", async () => {
    const fake = createFakeConfigService()
    const lock = createProcessMutexLockPort()
    const store = createDurableOperatorStore({ config: fake, lock, projectKey: "p1" })
    const events: EventPort = {
      async appendAudit(_r, options) {
        return { ok: true, auditId: options?.eventId ?? "evt_x" }
      },
      async listAudits() {
        return []
      },
      async pruneAudits() {
        return 0
      },
    }
    const r = await mutateAuthority(
      {
        config: store.config,
        idempotency: store.idempotency,
        events,
        outbox: store.outbox,
        requireAudit: true,
        nowMs: () => 1_700_000_000_100,
      },
      {
        request: req({ idempotencyKey: "ok1" }),
        authority: "langlock",
        apply: () => ({ ok: true }),
      },
    )
    expect(r.ok).toBe(true)
    expect(r.outcome).not.toBe("audit_pending")
    expect((await store.outbox.listPending()).length).toBe(0)
  })

  test("same idempotency key rejects a different request payload", async () => {
    const store = createDurableOperatorStore({ config: createFakeConfigService(), lock: createProcessMutexLockPort() })
    const ports = {
      config: store.config,
      idempotency: store.idempotency,
      events: createMemoryEventPort(),
      outbox: store.outbox,
      nowMs: () => 1_700_000_000_500,
    }
    const first = await mutateAuthority(ports, {
      request: req({ idempotencyKey: "same-key", payload: { value: "one" } }),
      authority: "langlock",
      apply: () => ({ value: "one" }),
    })
    expect(first.ok).toBe(true)
    const different = await mutateAuthority(ports, {
      request: req({ idempotencyKey: "same-key", version: first.version, payload: { value: "two" } }),
      authority: "langlock",
      apply: () => ({ value: "two" }),
    })
    expect(different.ok).toBe(false)
    expect(different.outcome).toBe("invalid_argument")
    expect((await store.config.get("langlock"))?.payload).toEqual({ value: "one" })
  })
})

describe("T024 reconcile lease + concurrent", () => {
  test("concurrent reconcilers one winner", async () => {
    const fake = createFakeConfigService()
    const lock = createProcessMutexLockPort()
    const store = createDurableOperatorStore({ config: fake, lock, projectKey: "p1" })
    let publishes = 0
    const events: EventPort = {
      async appendAudit() {
        publishes += 1
        await new Promise((r) => setTimeout(r, 5))
        return { ok: true, auditId: "evt_c" }
      },
      async listAudits() {
        return []
      },
      async pruneAudits() {
        return 0
      },
    }
    // Seed pending via mutate fail path
    await mutateAuthority(
      {
        config: store.config,
        idempotency: store.idempotency,
        events: {
          appendAudit: async () => ({ ok: false, code: "unavailable", reason: "x" }),
          listAudits: async () => [],
          pruneAudits: async () => 0,
        },
        outbox: store.outbox,
        requireAudit: true,
        nowMs: () => 1_700_000_000_200,
      },
      {
        request: req({ idempotencyKey: "c1" }),
        authority: "langlock",
        apply: () => ({ v: 1 }),
      },
    )
    const [a, b] = await Promise.all([
      reconcileOperatorAuditOutbox({ outbox: store.outbox, events, ownerId: "A" }),
      reconcileOperatorAuditOutbox({ outbox: store.outbox, events, ownerId: "B" }),
    ])
    expect(a.delivered + b.delivered).toBeGreaterThanOrEqual(1)
    expect((await store.outbox.listPending()).length).toBe(0)
  })

  test("malformed body is dead-lettered and does not retry forever", async () => {
    const outbox = createMemoryOutboxPort()
    await outbox.enqueue({ target: "operator.audit", payloadHash: "bad", nowMs: 1, body: { record: null } })
    let publishes = 0
    const events: EventPort = {
      appendAudit: async () => {
        publishes += 1
        return { ok: true, auditId: "never" }
      },
      listAudits: async () => [],
      pruneAudits: async () => 0,
    }
    const first = await reconcileOperatorAuditOutbox({ outbox, events, ownerId: "dead-letter" })
    const second = await reconcileOperatorAuditOutbox({ outbox, events, ownerId: "dead-letter" })
    expect(first.deadLetter).toBe(1)
    expect(second.attempted).toBe(0)
    expect(publishes).toBe(0)
  })

  test("max-attempt claim increments deadLetter metric and retains dead-lettered row", async () => {
    const outbox = createMemoryOutboxPort({ maxAttempts: 2 })
    const record = sampleRecord({ createdAtMs: 99 })
    const eventId = stableOperatorAuditEventIdFromRecord(record)
    await outbox.enqueue({
      id: eventId,
      target: "operator.audit",
      payloadHash: eventId,
      nowMs: 99,
      body: { record, projectKey: "p1", eventId },
    })
    const events: EventPort = {
      appendAudit: async () => ({ ok: false, code: "unavailable", reason: "down" }),
      listAudits: async () => [],
      pruneAudits: async () => 0,
    }
    // attempt 1 + 2 fail publish; attempt 3 claim → dead_letter
    expect((await reconcileOperatorAuditOutbox({ outbox, events, ownerId: "a", nowMs: 1_000 })).failed).toBe(1)
    expect((await reconcileOperatorAuditOutbox({ outbox, events, ownerId: "a", nowMs: 100_000 })).failed).toBe(1)
    const exhausted = await reconcileOperatorAuditOutbox({ outbox, events, ownerId: "a", nowMs: 200_000 })
    expect(exhausted.deadLetter).toBe(1)
    expect(exhausted.delivered).toBe(0)
    expect((await outbox.listPending()).length).toBe(0)
  })

  test("rollback CAS includes atomic auditIntent under requireAudit", async () => {
    const store = createDurableOperatorStore({
      config: createFakeConfigService(),
      lock: createProcessMutexLockPort(),
      projectKey: "p1",
    })
    const events: EventPort = {
      appendAudit: async () => ({ ok: false, code: "unavailable", reason: "down" }),
      listAudits: async () => [],
      pruneAudits: async () => 0,
    }
    const ports = {
      config: store.config,
      idempotency: store.idempotency,
      rollback: store.rollback,
      events,
      outbox: store.outbox,
      requireAudit: true,
      nowMs: () => 1_700_000_200_000,
    }
    const cut = await mutateAuthority(ports, {
      request: req({
        id: "semantic.embedding.cutover" as CommandRequest["id"],
        idempotencyKey: "cut-rb",
      }),
      authority: "semantic.embedding",
      apply: () => ({ binding: "v2" }),
      cutoverDomain: "semantic.embedding",
    })
    expect(cut.ok).toBe(true)
    // Drain cutover intent so rollback intent is observable alone.
    for (const pending of await store.outbox.listPending()) {
      await store.outbox.markDelivered(pending.id)
    }
    const rb = await mutateAuthority(ports, {
      request: req({
        id: "semantic.embedding.rollback" as CommandRequest["id"],
        version: cut.version,
        idempotencyKey: "rb-atomic",
      }),
      authority: "semantic.embedding",
      apply: (c) => c,
      rollbackDomain: "semantic.embedding",
    })
    expect(rb.outcome).toBe("audit_pending")
    expect(typeof rb.version).toBe("string")
    const pending = await store.outbox.listPending()
    expect(pending.length).toBe(1)
    const body = pending[0]!.body as { record: AuditRecord; eventId: string }
    expect(body.record.commandId).toBe("semantic.embedding.rollback")
    expect(body.record.afterVersion).toBe(rb.version as string)
    expect(body.eventId).toBe(stableOperatorAuditEventIdFromRecord(body.record))
  })

  test("memory config port stores auditIntent atomically (test-only)", async () => {
    const config = createMemoryConfigPort()
    const cas = await config.compareAndSet({
      authority: "langlock",
      expectedVersion: null,
      payload: { x: 1 },
      nowMs: 10,
      auditIntent: {
        record: {
          source: "cli",
          actorRef: "operator:local",
          scope: { kind: "project", ref: "p1" },
          commandId: "langlock.set",
          beforeVersion: null,
          outcome: "success",
          createdAtMs: 10,
        },
        projectKey: "p1",
      },
    })
    expect(cas.ok).toBe(true)
    if (!cas.ok) return
    const intents = config.listAuditIntents()
    expect(intents).toHaveLength(1)
    expect(intents[0]!.afterVersion).toBe(cas.version)
    expect(intents[0]!.record.afterVersion).toBe(cas.version)
  })
})

describe("T024 prune 89/91 + maintenance dispose", () => {
  test("memory prune", async () => {
    const port = createMemoryEventPort()
    const now = Date.now()
    const day = 86_400_000
    await port.appendAudit(sampleRecord({ createdAtMs: now - 89 * day, afterVersion: "v89" }))
    await port.appendAudit(sampleRecord({ createdAtMs: now - 91 * day, afterVersion: "v91" }))
    expect(await port.pruneAudits(now - 90 * day)).toBe(1)
    expect((await port.listAudits()).map((a) => a.afterVersion)).toEqual(["v89"])
  })

  test("maintenance dispose stops timer", async () => {
    let prunes = 0
    const events: EventPort = {
      appendAudit: async () => ({ ok: true, auditId: "e" }),
      listAudits: async () => [],
      pruneAudits: async () => {
        prunes += 1
        return 0
      },
    }
    const h = startOperatorAuditMaintenance({
      events,
      intervalMs: 20,
      pruneIntervalMs: 1,
    })
    await new Promise((r) => setTimeout(r, 50))
    h.dispose()
    const at = prunes
    await new Promise((r) => setTimeout(r, 50))
    expect(prunes).toBe(at) // no more after dispose
    expect(at).toBeGreaterThanOrEqual(1)
  })

  test("maintenance surfaces prune errors without silent zero success", async () => {
    const errors: Array<{ code: string; phase: string }> = []
    const events: EventPort = {
      appendAudit: async () => ({ ok: true, auditId: "e" }),
      listAudits: async () => [],
      pruneAudits: async () => {
        throw new Error("sqlite prune failed /tmp/secret-path")
      },
    }
    const h = startOperatorAuditMaintenance({
      events,
      intervalMs: 60_000,
      pruneIntervalMs: 1,
      runOnStart: false,
      nowMs: () => 1_000,
      onError: (error) => errors.push({ code: error.code, phase: error.phase }),
    })
    const result = await h.runOnce()
    h.dispose()
    expect(result.failed).toBe(true)
    expect(result.error?.phase).toBe("prune")
    expect(result.error?.code).toBe("audit_prune_failed")
    expect(result.error?.message).not.toContain("/tmp/secret-path")
    expect(result.pruned).toBe(0)
    expect(errors).toHaveLength(1)
    // Next tick still runs (not disposed / not stuck).
    const again = await startOperatorAuditMaintenance({
      events: {
        ...events,
        pruneAudits: async () => 0,
      },
      intervalMs: 60_000,
      pruneIntervalMs: 1,
      runOnStart: false,
      nowMs: () => 2_000,
    }).runOnce()
    expect(again.failed).toBeFalsy()
    expect(again.pruned).toBe(0)
  })

  test("overlapping ticks coalesce; prune respects pruneIntervalMs", async () => {
    let prunes = 0
    let clock = 1_000
    const events: EventPort = {
      appendAudit: async () => ({ ok: true, auditId: "e" }),
      listAudits: async () => [],
      pruneAudits: async () => {
        await Bun.sleep(40)
        prunes += 1
        return 0
      },
    }
    const ticks: Array<{ skipped: boolean; reason?: string; prunedThisTick?: boolean }> = []
    const h = startOperatorAuditMaintenance({
      events,
      intervalMs: 60_000,
      pruneIntervalMs: 1000,
      runOnStart: false,
      nowMs: () => clock,
      onTick: (t) => ticks.push(t),
    })
    // Hold first tick open (slow prune) to prove in_flight coalesce.
    const slow = h.runOnce()
    await Bun.sleep(5)
    const skipped = await h.runOnce()
    expect(skipped.skipped).toBe(true)
    expect(skipped.reason).toBe("in_flight")
    const first = await slow
    expect(first.skipped).toBe(false)
    expect(first.prunedThisTick).toBe(true)
    expect(prunes).toBe(1)
    // Same prune window: reconcile may run, prune skipped
    clock += 100
    const second = await h.runOnce()
    expect(second.skipped).toBe(false)
    expect(second.prunedThisTick).toBe(false)
    expect(prunes).toBe(1)
    // After prune interval: prune again
    clock += 1000
    const third = await h.runOnce()
    expect(third.prunedThisTick).toBe(true)
    expect(prunes).toBe(2)
    h.dispose()
    expect(ticks.length).toBeGreaterThanOrEqual(3)
  })
})

describe("T024 bounded list contract", () => {
  test("listAuditsResult fail-closed shape", async () => {
    const { createLiveEventV2AuditPortFromUse } = await import("@/operator/adapters/outbound/event-v2-live")
    const port = createLiveEventV2AuditPortFromUse({
      useEvents: async () => {
        throw new Error("backend down")
      },
    })
    const r = await port.listAuditsResult?.({ limit: 10 })
    expect(r?.ok).toBe(false)
    if (r && !r.ok) expect(r.reason).toContain("backend")
  })
})
