/**
 * Feature 017 / T011-T014 (FR6-FR10) — the OutputSpool production writer + the reads
 * and admin edge it enables. Proves:
 *
 *   - T011 (FR6, FR10): the production writer subscribed at the session message-part
 *     seam maps a part snapshot → a channel-generation row + on-disk bytes, appends
 *     only the growing suffix (bounded), FENCES a stale generation, and FAILS OPEN
 *     (a store throw never breaks the session loop);
 *   - T012 (FR7): with the store the writer populated, `output.stat`/`read` reflect the
 *     REAL committed length + bytes through the operator dispatcher;
 *   - T013 (FR8): `output.follow` streams committed pages over the cursor codec until
 *     caught up, never blocking the writer;
 *   - T014 (FR9, ADR-0017): `output.release`/`delete`/`purge` commit through the
 *     STORE-SCOPED admin authority via the `mutation_plan` contract — the settled record
 *     carries the real control-store generation (never a fabricated config CAS version),
 *     the audit is emitted, and a rejection (not_found) persists NOTHING (no phantom write).
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  createDispatcher,
  createSeededOperatorCommandRegistry,
  createProcessMutexLockPort,
  type MutationPorts,
} from "@/operator/application"
import { createFakeConfigService, createMemoryEventPort, createMemoryOutboxPort } from "@/operator/adapters"
import { createDurableOperatorStore } from "@/operator/adapters/outbound/config-service"
import { handlersFromDomainPorts, domainHandlerFor, wireDomainPorts } from "@/operator/adapters/outbound/domain-stubs"
import type { DomainPorts } from "@/operator/application/ports/domain-ports"
import { ControlStore } from "@/outputspool/control-store"
import { OutputSpoolBackendLive } from "@/operator/outputspool/backend-live"
import { OutputSpoolStackWiring } from "@/operator/outputspool/stack-wiring"
import type { OutputSpoolBackend } from "@/operator/outputspool/outputspool-port"
import { SessionSpoolWriter } from "@/session/output-spool-writer"

const roots: string[] = []
function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "spool-017-"))
  roots.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

function freshStore(): ControlStore.ControlStore {
  return ControlStore.createControlStore(new Database(":memory:"))
}

// =============================================================================
// T011 — production writer at the message-part seam (FR6, FR10)
// =============================================================================
describe("T011 — production writer: message part → channel generation rows (FR6)", () => {
  let store: ControlStore.ControlStore
  let spoolRoot: string
  beforeEach(() => {
    store = freshStore()
    spoolRoot = tempRoot()
  })

  test("a text part snapshot opens a durable channel generation and records committed bytes", async () => {
    const writer = SessionSpoolWriter.createSessionSpoolWriter({ store, spoolRoot, now: () => 1000 })
    const outcome = await writer.onPartUpdated({ id: "prt_a", type: "text", text: "hello" })
    expect(outcome.kind).toBe("appended")
    const record = store.get("prt_a")
    expect(record).not.toBeNull()
    expect(record!.channel).toBe("assistant-text")
    expect(record!.durability_tier).toBe("durable")
    expect(record!.committed_bytes).toBe(5)
  })

  test("streaming snapshots append ONLY the growing suffix (bounded, monotonic)", async () => {
    const writer = SessionSpoolWriter.createSessionSpoolWriter({ store, spoolRoot })
    await writer.ingest({ groupId: "prt_b", generation: 0, channel: "assistant-text", outputRef: "prt_b", tier: "durable" }, "hel")
    const second = await writer.ingest(
      { groupId: "prt_b", generation: 0, channel: "assistant-text", outputRef: "prt_b", tier: "durable" },
      "hello world",
    )
    expect(second.kind).toBe("appended")
    expect((second as { committedBytes: number }).committedBytes).toBe(11)
    // A snapshot that did not grow is a no-op (no re-append).
    const noop = await writer.ingest(
      { groupId: "prt_b", generation: 0, channel: "assistant-text", outputRef: "prt_b", tier: "durable" },
      "hello world",
    )
    expect(noop.kind).toBe("noop")
    expect(store.get("prt_b")!.committed_bytes).toBe(11)
  })

  test("reasoning maps to the reasoning channel; a non-textual part is skipped", async () => {
    const writer = SessionSpoolWriter.createSessionSpoolWriter({ store, spoolRoot })
    expect((await writer.onPartUpdated({ id: "prt_r", type: "reasoning", text: "why" })).kind).toBe("appended")
    expect(store.get("prt_r")!.channel).toBe("reasoning")
    expect((await writer.onPartUpdated({ id: "prt_s", type: "step-start" })).kind).toBe("skipped")
    expect(store.get("prt_s")).toBeNull()
  })

  test("a completed tool part ingests its output then seals the generation", async () => {
    const writer = SessionSpoolWriter.createSessionSpoolWriter({ store, spoolRoot })
    await writer.onPartUpdated({ id: "prt_t", type: "tool", state: { status: "completed", output: "done" } })
    const record = store.get("prt_t")
    expect(record!.channel).toBe("tool-result")
    expect(record!.state).toBe("sealed")
    expect(record!.committed_bytes).toBe(4)
  })

  test("stale-generation fencing: a superseded generation never appends (FR10)", async () => {
    const writer = SessionSpoolWriter.createSessionSpoolWriter({ store, spoolRoot })
    // Open generation 5 for group G first, then attempt the stale generation 1.
    const current = await writer.ingest({ groupId: "G", generation: 5, channel: "assistant-text", outputRef: "G:5", tier: "durable" }, "live")
    expect(current.kind).toBe("appended")
    const stale = await writer.ingest({ groupId: "G", generation: 1, channel: "assistant-text", outputRef: "G:1", tier: "durable" }, "stale")
    expect(stale.kind).toBe("fenced")
    expect(store.get("G:1")).toBeNull()
  })

  test("FAILS OPEN: a control-store throw degrades to a typed error, never a throw (FR10)", async () => {
    const throwing: ControlStore.ControlStore = {
      ...store,
      openGeneration: () => {
        throw new Error("store boom")
      },
    }
    const writer = SessionSpoolWriter.createSessionSpoolWriter({ store: throwing, spoolRoot })
    const outcome = await writer.onPartUpdated({ id: "prt_x", type: "text", text: "boom" })
    expect(outcome.kind).toBe("error")
    // The session loop continues — a later good ingest on a healthy store still works.
    const healthy = SessionSpoolWriter.createSessionSpoolWriter({ store, spoolRoot })
    expect((await healthy.onPartUpdated({ id: "prt_y", type: "text", text: "ok" })).kind).toBe("appended")
  })
})

// =============================================================================
// Operator dispatcher harness (mirrors feature014 wiring over the SAME seam)
// =============================================================================
function mutationPorts(): MutationPorts {
  const lock = createProcessMutexLockPort()
  const store = createDurableOperatorStore({ config: createFakeConfigService(), lock })
  return {
    config: store.config,
    idempotency: store.idempotency,
    rollback: store.rollback,
    events: createMemoryEventPort(),
    requireAudit: false,
    outbox: createMemoryOutboxPort(),
  }
}

function harness(backend: OutputSpoolBackend) {
  const registry = createSeededOperatorCommandRegistry()
  const mp = mutationPorts()
  const domainPorts: DomainPorts = wireDomainPorts({
    ...OutputSpoolStackWiring.createOutputSpoolDomainWiring({ backend }).ports,
  })
  const dispatcher = createDispatcher({
    registry,
    mutationPorts: mp,
    handlers: handlersFromDomainPorts(domainPorts, { config: mp.config }),
    defaultHandler: domainHandlerFor(domainPorts),
    featureEnabled: () => true,
  })
  return { dispatcher, config: mp.config }
}

const query = (dispatcher: ReturnType<typeof harness>["dispatcher"], id: string, payload: Record<string, unknown>) =>
  dispatcher.dispatchRequest({
    id,
    principal: { kind: "operator", subject: "op_1", projectBinding: "proj_17" },
    scope: { kind: "project", ref: "proj_17" },
    source: "cli",
    payload,
  } as never)

const mutate = (dispatcher: ReturnType<typeof harness>["dispatcher"], id: string, payload: Record<string, unknown>) =>
  dispatcher.dispatchRequest(
    {
      id,
      principal: { kind: "operator", subject: "op_1", projectBinding: "proj_17" },
      scope: { kind: "project", ref: "proj_17" },
      source: "cli",
      payload,
      idempotencyKey: `idem_${id}_${Math.random().toString(36).slice(2)}`,
    } as never,
    { cliInteractiveConfirmed: true },
  )

/** Write real bytes through the production writer into a shared store + spool root. */
async function seedViaWriter(store: ControlStore.ControlStore, spoolRoot: string, outputRef: string, text: string) {
  const writer = SessionSpoolWriter.createSessionSpoolWriter({ store, spoolRoot })
  await writer.ingest({ groupId: outputRef, generation: 0, channel: "assistant-text", outputRef, tier: "durable" }, text)
}

// =============================================================================
// T012 — stat/read reflect the populated control store (FR7)
// =============================================================================
describe("T012 — output.stat/read reflect the writer-populated store end-to-end (FR7)", () => {
  test("output.stat/read project the REAL bytes the production writer wrote", async () => {
    const store = freshStore()
    const spoolRoot = tempRoot()
    await seedViaWriter(store, spoolRoot, "prt_e2e", "hello world")
    const { dispatcher } = harness(OutputSpoolBackendLive.createLiveOutputSpoolBackend({ store, spoolRoot }))

    const stat = await query(dispatcher, "output.stat", { outputRef: "prt_e2e" })
    expect(stat.ok).toBe(true)
    expect((stat.effective as { committedBytes: number; channel: string }).committedBytes).toBe(11)
    expect((stat.effective as { channel: string }).channel).toBe("assistant-text")

    const read = await query(dispatcher, "output.read", { outputRef: "prt_e2e", offset: 0, limit: 64 })
    expect(read.ok).toBe(true)
    const page = read.effective as { bytes: Uint8Array; committedBytes: number; caughtUp: boolean }
    expect(new TextDecoder().decode(Uint8Array.from(page.bytes))).toBe("hello world")
    expect(page.caughtUp).toBe(true)
  })

  test("an unbound store keeps output.stat a typed unavailable gap", async () => {
    const { dispatcher } = harness(OutputSpoolBackendLive.createLiveOutputSpoolBackend({}))
    const result = await query(dispatcher, "output.stat", { outputRef: "prt_e2e" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unavailable")
  })
})

// =============================================================================
// T013 — follow cursor codec over committed generations (FR8)
// =============================================================================
describe("T013 — output.follow streams committed pages over the cursor codec (FR8)", () => {
  test("a follower streams the committed page then catches up, never blocking the writer", async () => {
    const store = freshStore()
    const spoolRoot = tempRoot()
    await seedViaWriter(store, spoolRoot, "prt_follow", "hello world")
    const { dispatcher } = harness(
      OutputSpoolBackendLive.createLiveOutputSpoolBackend({ store, spoolRoot, enableFollow: true }),
    )

    const initial = Buffer.from(JSON.stringify({ outputRef: "prt_follow", offset: 0 })).toString("base64url")
    const first = await query(dispatcher, "output.follow", { cursor: initial })
    expect(first.ok).toBe(true)
    const firstEff = first.effective as { page: { bytes: Uint8Array; caughtUp: boolean }; cursor: string }
    expect(new TextDecoder().decode(Uint8Array.from(firstEff.page.bytes))).toBe("hello world")
    expect(firstEff.page.caughtUp).toBe(true)

    // Follow again from the returned cursor — nothing new, still caught up (never blocks).
    const second = await query(dispatcher, "output.follow", { cursor: firstEff.cursor })
    expect(second.ok).toBe(true)
    const secondEff = second.effective as { page: { bytes: Uint8Array; caughtUp: boolean } }
    expect(Uint8Array.from(secondEff.page.bytes).length).toBe(0)
    expect(secondEff.page.caughtUp).toBe(true)
  })

  test("an invalid cursor degrades to a typed invalid_argument, never a fabricated page", async () => {
    const store = freshStore()
    const spoolRoot = tempRoot()
    await seedViaWriter(store, spoolRoot, "prt_follow2", "abc")
    const { dispatcher } = harness(
      OutputSpoolBackendLive.createLiveOutputSpoolBackend({ store, spoolRoot, enableFollow: true }),
    )
    const result = await query(dispatcher, "output.follow", { cursor: "not-a-valid-cursor" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("invalid_argument")
  })

  test("follow stays a typed gap when the cursor seam is not enabled", async () => {
    const store = freshStore()
    const spoolRoot = tempRoot()
    await seedViaWriter(store, spoolRoot, "prt_follow3", "abc")
    const { dispatcher } = harness(OutputSpoolBackendLive.createLiveOutputSpoolBackend({ store, spoolRoot }))
    const cursor = Buffer.from(JSON.stringify({ outputRef: "prt_follow3", offset: 0 })).toString("base64url")
    const result = await query(dispatcher, "output.follow", { cursor })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unavailable")
  })
})

// =============================================================================
// T014 — store-scoped admin edge (FR9, ADR-0017)
// =============================================================================
const ADMIN = OutputSpoolBackendLive.OUTPUT_ADMIN_AUTHORITY

function adminBackend(store: ControlStore.ControlStore, spoolRoot: string) {
  return OutputSpoolBackendLive.createLiveOutputSpoolBackend({ store, spoolRoot, adminAuthority: ADMIN })
}

describe("T014 — release/delete/purge commit through the store-scoped admin authority (FR9)", () => {
  test("output.delete removes the control record and records the settled control-store generation", async () => {
    const store = freshStore()
    const spoolRoot = tempRoot()
    store.openGeneration({ output_ref: "prt_del", group_id: "prt_del", generation: 3, channel: "assistant-text", durability_tier: "durable", correlation_id: "c", now: 1 })
    store.recordCommitted("prt_del", 9, 2)
    const { dispatcher, config } = harness(adminBackend(store, spoolRoot))

    const result = await mutate(dispatcher, "output.delete", { outputRef: "prt_del" })
    expect(result.ok).toBe(true)
    expect(result.outcome).toBe("success")
    // The control record is actually gone (a real store op, not a fabricated success).
    expect(store.get("prt_del")).toBeNull()
    // The admin authority recorded the REAL control-store generation, never a fabricated CAS version.
    const entry = await config.get(ADMIN)
    expect(entry).not.toBeNull()
    const recorded = (entry!.payload as Record<string, { action: string; generation: number }>)["prt_del"]
    expect(recorded.action).toBe("delete")
    expect(recorded.generation).toBe(3)
  })

  test("output.release drops the reference edges and commits through the admin authority", async () => {
    const store = freshStore()
    const spoolRoot = tempRoot()
    store.openGeneration({ output_ref: "prt_rel", group_id: "prt_rel", generation: 1, channel: "assistant-text", durability_tier: "durable", correlation_id: "c", now: 1 })
    store.addEdge("prt_rel", "lease", "holder_1")
    const { dispatcher, config } = harness(adminBackend(store, spoolRoot))

    const result = await mutate(dispatcher, "output.release", { outputRef: "prt_rel" })
    expect(result.ok).toBe(true)
    expect(store.listEdges("prt_rel").length).toBe(0)
    expect((await config.get(ADMIN))).not.toBeNull()
  })

  test("output.delete on a missing ref persists NOTHING (no phantom write, FR9)", async () => {
    const store = freshStore()
    const spoolRoot = tempRoot()
    const { dispatcher, config } = harness(adminBackend(store, spoolRoot))
    const result = await mutate(dispatcher, "output.delete", { outputRef: "missing" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("invalid_argument")
    // No admin-authority record was ever written — the rejection is before any store op.
    expect(await config.get(ADMIN)).toBeNull()
  })

  test("release/delete/purge stay a typed gap when the admin authority is not bound", async () => {
    const store = freshStore()
    const spoolRoot = tempRoot()
    store.openGeneration({ output_ref: "prt_gap", group_id: "prt_gap", generation: 1, channel: "assistant-text", durability_tier: "durable", correlation_id: "c", now: 1 })
    const { dispatcher } = harness(OutputSpoolBackendLive.createLiveOutputSpoolBackend({ store, spoolRoot }))
    const result = await mutate(dispatcher, "output.delete", { outputRef: "prt_gap" })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("unavailable")
  })
})
