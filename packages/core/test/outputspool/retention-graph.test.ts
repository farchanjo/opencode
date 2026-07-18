import { describe, expect, test } from "bun:test"
import { RetentionGraph } from "@opencode-ai/core/outputspool/retention-graph"
import type { Retention } from "@opencode-ai/schema/outputspool/retention"
import type { Enums } from "@opencode-ai/schema/outputspool/enums"

// Feature 005 / T021 (S11) — reference-aware retention reclaim. Deterministic over
// an injected clock; no I/O (FR28-FR30, C5, AC16, AC17).

const holder = (s: string) => s as unknown as RetentionGraph.HolderRef

const descriptor = (over: Partial<Retention.RetentionDescriptor> = {}): Retention.RetentionDescriptor => ({
  ttl_ms: 1000 as unknown as Retention.TtlMs,
  legal_hold: "none" as Enums.LegalHoldState,
  lease: null,
  edges: [],
  ...over,
})

const input = (
  d: Retention.RetentionDescriptor,
  active = false,
  created_at_ms = 0,
): RetentionGraph.ReclaimInput => ({ descriptor: d, created_at_ms, active_reader_or_writer: active })

describe("RetentionGraph — reclaim eligibility", () => {
  test("reclaims a fully unreferenced expired group", () => {
    expect(RetentionGraph.isReclaimable(input(descriptor()), 2000)).toEqual({ reclaimable: true })
  })
  test("an inbound edge blocks reclaim", () => {
    const d = descriptor({ edges: [{ kind: "transcript" as Enums.RetentionEdgeKind, holder_ref: holder("h1") }] })
    expect(RetentionGraph.isReclaimable(input(d), 2000)).toEqual({ reclaimable: false, reason: "referenced" })
  })
  test("a live lease blocks reclaim", () => {
    const d = descriptor({
      lease: {
        lease_id: "l1" as unknown as never,
        holder_ref: holder("h1") as unknown as never,
        granted_at: 0 as unknown as never,
        expires_at: null,
      } as unknown as Retention.RetentionLease,
    })
    expect(RetentionGraph.isReclaimable(input(d), 2000).reclaimable).toBe(false)
  })
  test("an active reader/writer blocks reclaim", () => {
    expect(RetentionGraph.isReclaimable(input(descriptor(), true), 2000)).toEqual({ reclaimable: false, reason: "active" })
  })
  test("legal hold blocks reclaim (highest priority)", () => {
    const d = descriptor({ legal_hold: "hold" as Enums.LegalHoldState })
    expect(RetentionGraph.isReclaimable(input(d), 2000)).toEqual({ reclaimable: false, reason: "legal_hold" })
  })
  test("an unexpired group is not reclaimable", () => {
    expect(RetentionGraph.isReclaimable(input(descriptor()), 500)).toEqual({ reclaimable: false, reason: "not_expired" })
  })
})

describe("RetentionGraph — release drops one edge", () => {
  test("drops exactly one matching holder edge", () => {
    const d = descriptor({
      edges: [
        { kind: "transcript" as Enums.RetentionEdgeKind, holder_ref: holder("h1") },
        { kind: "todo" as Enums.RetentionEdgeKind, holder_ref: holder("h2") },
      ],
    })
    const r = RetentionGraph.release(d, holder("h1"))
    expect(r.dropped).toBe(true)
    expect(r.remaining_edge_count).toBe(1)
    expect(r.descriptor.edges[0]?.holder_ref).toBe(holder("h2"))
  })
  test("a missing holder is a no-op", () => {
    const d = descriptor({ edges: [{ kind: "todo" as Enums.RetentionEdgeKind, holder_ref: holder("h2") }] })
    const r = RetentionGraph.release(d, holder("hX"))
    expect(r.dropped).toBe(false)
    expect(r.remaining_edge_count).toBe(1)
  })
})

describe("RetentionGraph — bounded batch selection", () => {
  test("selects only reclaimable candidates up to the batch limit", () => {
    const reclaimable = { ref: "a", input: input(descriptor()) }
    const blocked = {
      ref: "b",
      input: input(descriptor({ edges: [{ kind: "handoff" as Enums.RetentionEdgeKind, holder_ref: holder("h") }] })),
    }
    const another = { ref: "c", input: input(descriptor()) }
    const batch = RetentionGraph.selectBatch([reclaimable, blocked, another], 1, 2000)
    expect(batch).toEqual(["a"])
  })
})
