import { describe, expect, test } from "bun:test"
import {
  createDurableOperatorStore,
  createFakeConfigService,
  createMemoryConfigPort,
  createMemoryEventPort,
  createMemoryIdempotencyPort,
  createMemoryOutboxPort,
  createMemoryRollbackPort,
  createBrokenLocalOutboxPort,
} from "@/operator/adapters"
import {
  createProcessMutexLockPort,
  mutateAuthority,
  pruneSnapshotsForAuthority,
} from "@/operator/application"
import type { CommandRequest } from "@opencode-ai/core/operator"
import { SNAPSHOT_MAX_COUNT, selectAuditsToPrune, AUDIT_RETENTION_DAYS } from "@opencode-ai/core/operator"

function req(overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    id: "langlock.set" as CommandRequest["id"],
    principal: { kind: "operator", subject: "local", projectBinding: null },
    scope: { kind: "project", ref: "p1" },
    source: "cli",
    isTty: false,
    confirm: false,
    idempotencyKey: overrides.idempotencyKey ?? "idemp-" + Math.random().toString(36).slice(2),
    ...overrides,
  }
}

describe("ConfigPort + CAS (T013–T014)", () => {
  test("memory CAS write and conflict on stale version", async () => {
    const config = createMemoryConfigPort()
    const first = await config.compareAndSet({
      authority: "project:p1",
      expectedVersion: null,
      payload: { language: "en" },
      nowMs: 1,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const ok = await config.compareAndSet({
      authority: "project:p1",
      expectedVersion: first.version,
      payload: { language: "pt" },
      nowMs: 2,
    })
    expect(ok.ok).toBe(true)

    const conflict = await config.compareAndSet({
      authority: "project:p1",
      expectedVersion: first.version,
      payload: { language: "es" },
      nowMs: 3,
    })
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.code).toBe("conflict")
  })

  test("concurrent write simulation: one success one conflict", async () => {
    const config = createMemoryConfigPort()
    await config.compareAndSet({
      authority: "a",
      expectedVersion: null,
      payload: { v: 0 },
      nowMs: 0,
    })
    const current = await config.get("a")
    const v = current!.version
    const [r1, r2] = await Promise.all([
      config.compareAndSet({ authority: "a", expectedVersion: v, payload: { v: 1 }, nowMs: 1 }),
      config.compareAndSet({ authority: "a", expectedVersion: v, payload: { v: 2 }, nowMs: 1 }),
    ])
    const successes = [r1, r2].filter((r) => r.ok)
    const conflicts = [r1, r2].filter((r) => !r.ok)
    expect(successes.length).toBe(1)
    expect(conflicts.length).toBe(1)
  })

  test("Config.Service durable adapter uses fake Config.Service only (no parallel store)", async () => {
    const svc = createFakeConfigService()
    const store = createDurableOperatorStore({ config: svc, lock: createProcessMutexLockPort() })
    const cas = await store.config.compareAndSet({
      authority: "project",
      expectedVersion: null,
      payload: { lang: "en-US" },
      nowMs: 10,
    })
    expect(cas.ok).toBe(true)
    const dump = svc.dump()
    expect(dump.project.operator).toBeDefined()
    expect(JSON.stringify(dump)).not.toContain("sk_live")
  })
})

describe("idempotency (T015)", () => {
  test("replay returns idempotent_replay with same body", async () => {
    let clock = 100
    const ports = {
      config: createMemoryConfigPort(),
      idempotency: createMemoryIdempotencyPort(),
      events: createMemoryEventPort(),
      outbox: createMemoryOutboxPort(),
      nowMs: () => clock++,
    }
    const request = req({
      idempotencyKey: "key-1",
      version: undefined,
    })
    const r1 = await mutateAuthority(ports, {
      request,
      authority: "project:p1",
      apply: () => ({ language: "en" }),
    })
    expect(r1.ok).toBe(true)
    expect(r1.outcome).toBe("success")

    const r2 = await mutateAuthority(ports, {
      request: { ...request, version: r1.version },
      authority: "project:p1",
      apply: () => ({ language: "SHOULD_NOT_APPLY" }),
    })
    expect(r2.outcome).toBe("idempotent_replay")
    expect(r2.effective).toEqual(r1.effective)
  })
})

describe("snapshots (T016)", () => {
  test("11th snapshot drops oldest via prune", async () => {
    const config = createMemoryConfigPort()
    await config.compareAndSet({
      authority: "a",
      expectedVersion: null,
      payload: { n: 0 },
      nowMs: 0,
    })
    for (let i = 0; i < SNAPSHOT_MAX_COUNT + 1; i++) {
      await config.snapshot({ authority: "a", nowMs: i + 1, id: `s${i}` })
    }
    const pruned = await pruneSnapshotsForAuthority(config, "a", SNAPSHOT_MAX_COUNT + 2)
    expect(pruned).toBeGreaterThanOrEqual(1)
    const left = await config.listSnapshots("a")
    expect(left.length).toBeLessThanOrEqual(SNAPSHOT_MAX_COUNT)
  })
})

describe("cutover rollback slot (T017)", () => {
  test("rollback without slot → structured error; with slot restores full payload", async () => {
    let clock = 1
    const ports = {
      config: createMemoryConfigPort(),
      idempotency: createMemoryIdempotencyPort(),
      rollback: createMemoryRollbackPort(),
      events: createMemoryEventPort(),
      outbox: createMemoryOutboxPort(),
      nowMs: () => clock++,
    }
    const missing = await mutateAuthority(ports, {
      request: req({
        id: "semantic.embedding.rollback" as CommandRequest["id"],
        confirm: true,
        source: "api",
        idempotencyKey: "miss",
      }),
      authority: "semantic.embedding",
      apply: (c) => c,
      rollbackDomain: "semantic.embedding",
    })
    expect(missing.ok).toBe(false)
    expect(missing.outcome).toBe("unavailable")

    const cut = await mutateAuthority(ports, {
      request: req({
        id: "semantic.embedding.cutover" as CommandRequest["id"],
        confirm: true,
        source: "api",
        idempotencyKey: "cut-1",
      }),
      authority: "semantic.embedding",
      apply: () => ({ binding: "v2", full: true }),
      cutoverDomain: "semantic.embedding",
      snapshotBefore: true,
    })
    expect(cut.ok).toBe(true)

    const rb = await mutateAuthority(ports, {
      request: req({
        id: "semantic.embedding.rollback" as CommandRequest["id"],
        confirm: true,
        source: "api",
        version: cut.version,
        idempotencyKey: "rb-1",
      }),
      authority: "semantic.embedding",
      apply: (c) => c,
      rollbackDomain: "semantic.embedding",
    })
    expect(rb.ok).toBe(true)
    // first cutover had null prior payload
    expect(rb.effective).toBeNull()
  })
})

describe("audit + outbox + retention (T022–T024)", () => {
  test("audit record secret-free with required fields", async () => {
    const events = createMemoryEventPort()
    const ports = {
      config: createMemoryConfigPort(),
      idempotency: createMemoryIdempotencyPort(),
      events,
      outbox: createMemoryOutboxPort(),
      nowMs: () => 50,
    }
    const result = await mutateAuthority(ports, {
      request: req({ idempotencyKey: "a1" }),
      authority: "project:p1",
      apply: () => ({ x: 1 }),
    })
    expect(result.ok).toBe(true)
    expect(result.auditId).toBeDefined()
    const audits = await events.listAudits()
    expect(audits.length).toBe(1)
    const a = audits[0]!
    expect(a.source).toBe("cli")
    expect(a.commandId).toBe("langlock.set")
    expect(a.actorRef).toContain("operator")
    expect(a.afterVersion).toBeTruthy()
    expect(JSON.stringify(a)).not.toMatch(/password|sk_live|Bearer /i)
  })

  test("local mutation does not require outbox", async () => {
    const ports = {
      config: createMemoryConfigPort(),
      idempotency: createMemoryIdempotencyPort(),
      outbox: createMemoryOutboxPort(),
      nowMs: () => 1,
    }
    const result = await mutateAuthority(ports, {
      request: req({ idempotencyKey: "local-1" }),
      authority: "a",
      apply: () => ({ ok: true }),
    })
    expect(result.ok).toBe(true)
    expect(ports.outbox.requiredForLocalMutation()).toBe(false)
  })

  test("broken outbox that requires local fails closed", async () => {
    const ports = {
      config: createMemoryConfigPort(),
      idempotency: createMemoryIdempotencyPort(),
      outbox: createBrokenLocalOutboxPort(),
      nowMs: () => 1,
    }
    const result = await mutateAuthority(ports, {
      request: req({ idempotencyKey: "bad-outbox" }),
      authority: "a",
      apply: () => ({ ok: true }),
    })
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe("unavailable")
  })

  test("audit retention constant 90 days + prune selection", async () => {
    expect(AUDIT_RETENTION_DAYS).toBe(90)
    const now = 200 * 86_400_000
    const events = createMemoryEventPort()
    await events.appendAudit({
      source: "cli",
      actorRef: "operator:local",
      scope: { kind: "project", ref: "p" },
      commandId: "langlock.set",
      beforeVersion: null,
      afterVersion: "cas_v1",
      outcome: "success",
      createdAtMs: now - 100 * 86_400_000,
    })
    await events.appendAudit({
      source: "cli",
      actorRef: "operator:local",
      scope: { kind: "project", ref: "p" },
      commandId: "langlock.set",
      beforeVersion: null,
      afterVersion: "cas_v2",
      outcome: "success",
      createdAtMs: now - 1000,
    })
    const listed = await events.listAudits()
    const drop = selectAuditsToPrune(
      listed.map((x) => ({ id: x.id, createdAtMs: x.createdAtMs })),
      now,
    )
    expect(drop.length).toBe(1)
    const n = await events.pruneAudits(drop)
    expect(n).toBe(1)
    expect((await events.listAudits()).length).toBe(1)
  })
})
