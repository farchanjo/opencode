/**
 * Feature 006 / T033 (S19) — durable/live semantic event projection acceptance.
 *
 * A durable settlement event projects onto its wire Definition carrying the
 * top-level correlation_id (reaches the bridge boundary once), a live signal is
 * droppable and omits correlation_id, and no payload carries content or a path
 * (FR12, FR13, FR41, FR42, C22).
 */
import { describe, expect, test } from "bun:test"
import { DurableEvents } from "@/semantic/durable-events"
import type { Events as SemanticEvents } from "@opencode-ai/schema/semantic/events"

const envelope = {
  event_id: "evt_1",
  ordering: { sequence: 1, correlation_id: "corr-abc", causation_id: null },
} as unknown as SemanticEvents.SemanticEvent extends { envelope: infer E } ? E : never

const durableEvent = {
  type: "semantic.binding_cutover",
  envelope,
  detail: { generation_id: "gen-1", outcome: "committed" },
} as unknown as SemanticEvents.SemanticEvent

const liveEvent = {
  type: "semantic.retrieval_degraded",
  envelope,
  detail: { gap: "milvus_unavailable", mode: "catalog_lexical" },
} as unknown as SemanticEvents.SemanticEvent

describe("classification", () => {
  test("the nine settlement members are durable", () => {
    expect(DurableEvents.DURABLE_SEMANTIC_TYPES.size).toBe(9)
    expect(DurableEvents.isDurableSemanticEvent("semantic.binding_cutover")).toBe(true)
  })
  test("the three signal members are live and droppable", () => {
    expect(DurableEvents.LIVE_SEMANTIC_TYPES.size).toBe(3)
    expect(DurableEvents.isDroppableUnderLoad("semantic.retrieval_degraded")).toBe(true)
    expect(DurableEvents.isDroppableUnderLoad("semantic.binding_cutover")).toBe(false)
  })
})

describe("projectForPublish", () => {
  test("a durable member resolves its Definition and carries top-level correlation_id", () => {
    const projected = DurableEvents.projectForPublish(durableEvent)
    expect(projected.durable).toBe(true)
    expect(projected.definition.type).toBe("semantic.binding_cutover")
    expect(projected.data.correlation_id).toBe("corr-abc")
    // The discriminant is dropped (the Definition owns it).
    expect("type" in projected.data).toBe(false)
  })

  test("a live member omits correlation_id", () => {
    const projected = DurableEvents.projectForPublish(liveEvent)
    expect(projected.durable).toBe(false)
    expect(projected.definition.type).toBe("semantic.retrieval_degraded")
    expect("correlation_id" in projected.data).toBe(false)
  })

  test("no payload carries query text, a vector, or a path", () => {
    const projected = DurableEvents.projectForPublish(durableEvent)
    const serialized = JSON.stringify(projected.data)
    expect(serialized).not.toContain("/")
    expect(serialized.toLowerCase()).not.toContain("query")
    expect(serialized).not.toContain("vector")
  })
})
