/**
 * Feature 002 / T039 — lifecycle integration against the REAL EventV2 durable
 * store (SQLite), not the in-memory bridge fixture. Runs through the Feature 007
 * sandbox instance layer (`it.instance` → a tmpdir-backed real Database, the same
 * `.dev/` store the operator sandbox uses), driving the actual
 * `EventV2Bridge.Service` publish/commit/read seams the composition root wires in
 * `operator/lifecycle/stack-wiring.ts`.
 *
 * It exercises the file-backed paths the in-process fixtures cannot: durable
 * projection over the committed aggregate, replay/crash-recovery rebuild of a
 * fresh Process Table from the durable files, restart reconciliation into
 * `unknown`/`unreconciled` with no auto-retry, cross-root isolation on rebuild
 * (no sibling/cross-root leak, AC27), and single-event dual-endpoint handoff
 * durability (C16). Local loopback/tmpdir fixtures only — no external service.
 *
 * ACs: AC1 (durable aggregate projection), AC3 (replay rebuild), AC4 (restart
 * into unknown/unreconciled, no auto-retry), AC6 (single-event dual handoff),
 * AC13 (reconciliation), AC15 (cross-root isolation on rebuild).
 */
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { createProcessTable } from "@opencode-ai/core/lifecycle/process-table"
import { EventV2Bridge } from "@/event-v2-bridge"
import {
  createEventV2Adapter,
  normalizeRecord,
  type AggregateReader,
  type LifecycleBridge,
  type ReconcileResolver,
} from "@/lifecycle/eventv2-adapter"
import type { Enums } from "@opencode-ai/schema/lifecycle/enums"
import { emitEnvelope } from "./fixtures"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([EventV2Bridge.node])))

type Table = ReturnType<typeof createProcessTable>

const liveUsage = {
  available: true,
  tokens: { input: 10, output: 5 },
  cost_usd: 0.01,
  provenance: { provenance: "reported", source: "provider" },
  elapsed_ms: 1000,
  tokens_per_second: 5,
} as const

const admittedDetail = { scope: "session", decision: "granted", fanout: { requested: 1, granted: 1 } } as const
const completedDetail = { reason: "completed_ok", settlement: "settled", final_usage: liveUsage } as const

/**
 * Build the lifecycle adapter over the REAL bridge: publish through the durable
 * commit path, read the aggregate back through `readDurablePage` + `normalizeRecord`
 * exactly as `stack-wiring.ts` composes it (no in-memory fake).
 */
function buildAdapter(bridge: EventV2Bridge.Interface, table: Table, reconcile?: ReconcileResolver) {
  const lifecycleBridge: LifecycleBridge = {
    publishLifecycleEvent: (event, options) => bridge.publishLifecycleEvent(event, options),
  }
  const readAggregate: AggregateReader = (input) =>
    bridge
      .readDurablePage({ aggregateID: input.aggregateID, after: input.after, limit: input.limit })
      .pipe(
        Effect.map((page) => ({
          records: page.events.map(normalizeRecord),
          hasMore: page.hasMore,
          cursor: page.events.length > 0 ? page.lastSeq : null,
        })),
      )
  return createEventV2Adapter({ bridge: lifecycleBridge, table, readAggregate, reconcile })
}

/** Emit one lifecycle event through the adapter over the real durable store. */
function emit(
  adapter: ReturnType<typeof buildAdapter>,
  over: Parameters<typeof emitEnvelope>[0],
  data: Record<string, unknown> = {},
) {
  return adapter.emit({ envelope: emitEnvelope(over), eventType: over.eventType as Enums.LifecycleEventType, data })
}

describe("T039 durable integration — projection over the committed EventV2 aggregate (AC1)", () => {
  it.instance("a durable created→admitted→started→completed chain commits sequenced rows and reaches completed", () =>
    Effect.gen(function* () {
      const bridge = yield* EventV2Bridge.Service
      const table = createProcessTable()
      const adapter = buildAdapter(bridge, table)
      const root = { rootProcessId: "proc_root_a", processId: "proc_a", sessionId: "ses_a", rootSessionId: "ses_a" }

      const created = yield* emit(adapter, { ...root, eventType: "lifecycle.process_created" })
      const admitted = yield* emit(adapter, { ...root, eventType: "lifecycle.admitted" }, admittedDetail)
      const started = yield* emit(adapter, { ...root, eventType: "lifecycle.started" })
      const completed = yield* emit(adapter, { ...root, eventType: "lifecycle.completed" }, completedDetail)

      // Every durable emit committed a monotonic per-aggregate sequence.
      expect(created.durable?.seq).toBe(0)
      expect(admitted.durable?.seq).toBe(1)
      expect(started.durable?.seq).toBe(2)
      expect(completed.durable?.seq).toBe(3)
      expect(completed.durable?.aggregateID).toBe("proc_root_a")

      // The live table folded the durable commit hook into a terminal row.
      expect(table.get("proc_a" as never)?.status.state).toBe("completed")
    }),
  )
})

describe("T039 durable integration — replay/crash-recovery rebuild from real files (AC3)", () => {
  it.instance("a fresh Process Table rebuilds the terminal row by replaying the durable aggregate", () =>
    Effect.gen(function* () {
      const bridge = yield* EventV2Bridge.Service
      const root = { rootProcessId: "proc_root_b", processId: "proc_b", sessionId: "ses_b", rootSessionId: "ses_b" }

      // First runtime: publish a full lifecycle to the durable store.
      const writer = buildAdapter(bridge, createProcessTable())
      yield* emit(writer, { ...root, eventType: "lifecycle.process_created" })
      yield* emit(writer, { ...root, eventType: "lifecycle.admitted" }, admittedDetail)
      yield* emit(writer, { ...root, eventType: "lifecycle.started" })
      yield* emit(writer, { ...root, eventType: "lifecycle.completed" }, completedDetail)

      // "Crash": a brand-new Process Table with no live state replays the files.
      const recovered = createProcessTable()
      const reader = buildAdapter(bridge, recovered)
      const out = yield* reader.replay({ scope: "root", scopeId: "proc_root_b", limit: 100 })

      expect(out.hasMore).toBe(false)
      const rows = reader.rebuiltRows("root", "proc_root_b")
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id as string).toBe("proc_b")
      expect(rows[0]?.status.state).toBe("completed")
    }),
  )
})

describe("T039 durable integration — restart reconciliation into unknown/unreconciled, no auto-retry (AC4, AC13)", () => {
  it.instance("a non-terminal row with no live owner rebuilds as unknown and is never re-executed", () =>
    Effect.gen(function* () {
      const bridge = yield* EventV2Bridge.Service
      const root = { rootProcessId: "proc_root_c", processId: "proc_c", sessionId: "ses_c", rootSessionId: "ses_c" }

      // Publish an interrupted lifecycle: running, never terminal.
      const writer = buildAdapter(bridge, createProcessTable())
      yield* emit(writer, { ...root, eventType: "lifecycle.process_created" })
      yield* emit(writer, { ...root, eventType: "lifecycle.admitted" }, admittedDetail)
      yield* emit(writer, { ...root, eventType: "lifecycle.started" })

      // Restart: the owner is gone (owner_present false); reconciliation must
      // fence it to unknown and NEVER re-run the effect (FR40).
      const reconcile: ReconcileResolver = () => ({ owner_present: false, from_version: 1, durable_version: 1 })
      const recovered = createProcessTable()
      const reader = buildAdapter(bridge, recovered, reconcile)
      const out = yield* reader.replay({ scope: "root", scopeId: "proc_root_c", limit: 100 })

      expect(out.unreconciledCount).toBeGreaterThanOrEqual(1)
      const rows = reader.rebuiltRows("root", "proc_root_c")
      expect(rows[0]?.status.state).toBe("unknown")
    }),
  )
})

describe("T039 durable integration — cross-root isolation on rebuild (AC15, AC27)", () => {
  it.instance("replaying one root rebuilds only that root's processes, never a sibling root's", () =>
    Effect.gen(function* () {
      const bridge = yield* EventV2Bridge.Service
      const writer = buildAdapter(bridge, createProcessTable())

      const rootD = { rootProcessId: "proc_root_d", processId: "proc_d", sessionId: "ses_d", rootSessionId: "ses_d" }
      const rootE = { rootProcessId: "proc_root_e", processId: "proc_e", sessionId: "ses_e", rootSessionId: "ses_e" }
      yield* emit(writer, { ...rootD, eventType: "lifecycle.process_created" })
      yield* emit(writer, { ...rootE, eventType: "lifecycle.process_created" })

      // Reconnect/reconstruct root D only: no cross-root content bleeds in.
      const reader = buildAdapter(bridge, createProcessTable())
      yield* reader.replay({ scope: "root", scopeId: "proc_root_d", limit: 100 })
      const rows = reader.rebuiltRows("root", "proc_root_d")
      expect(rows.map((r) => String(r.id))).toEqual(["proc_d"])
      expect(reader.rebuiltRows("root", "proc_root_e")).toHaveLength(0)
    }),
  )
})

describe("T039 durable integration — single-event dual-endpoint handoff (AC6, C16)", () => {
  it.instance("one durable handoff event persists both source and target endpoints", () =>
    Effect.gen(function* () {
      const bridge = yield* EventV2Bridge.Service
      const root = { rootProcessId: "proc_root_f", processId: "proc_src", sessionId: "ses_src", rootSessionId: "ses_src" }
      const writer = buildAdapter(bridge, createProcessTable())
      yield* emit(writer, { ...root, eventType: "lifecycle.process_created" })

      const handoffDetail = {
        source: { session_id: "ses_src", process_id: "proc_src" },
        target: { session_id: "ses_dst", process_id: "proc_dst" },
        reason: "delegation",
        generation: 1,
      }
      const out = yield* emit(writer, { ...root, eventType: "lifecycle.handoff" }, handoffDetail)
      expect(out.durable).not.toBeNull()

      // The durable store carries exactly one handoff event with both endpoints —
      // a single event projectable to both the source and target sessions (C16).
      const page = yield* bridge.readDurablePage({ aggregateID: "proc_root_f", limit: 100 })
      const handoffs = page.events.filter((e) => e.type === "lifecycle.handoff")
      expect(handoffs).toHaveLength(1)
      const detail = (handoffs[0]!.data as { detail: typeof handoffDetail }).detail
      expect(detail.source.session_id).toBe("ses_src")
      expect(detail.target.session_id).toBe("ses_dst")
    }),
  )
})
