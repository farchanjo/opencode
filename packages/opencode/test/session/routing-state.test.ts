/**
 * Feature 051 / T003 — the `NarrowedSets` per-turn memo on the routing-state store.
 *
 * Asserts `recordNarrowedSets`/`get` round-trip the memo keyed by `lastUser.id`, that a
 * fresh session reads `narrowedSets: null`, and that `clear` drops the memo alongside the
 * existing routing-state fields (FR1; the memo is released with the session).
 */
import { describe, expect, test } from "bun:test"
import { RoutingState } from "@/session/routing-state"
import type { SessionID } from "@/session/schema"

const SESSION = "ses_narrow_memo" as SessionID

describe("RoutingState narrowedSets memo", () => {
  test("a fresh session reads narrowedSets null", () => {
    const store = RoutingState.createRoutingSessionStateStore()
    expect(store.get(SESSION).narrowedSets).toBeNull()
  })

  test("recordNarrowedSets round-trips the memo keyed by lastUser.id", () => {
    const store = RoutingState.createRoutingSessionStateStore()
    const sets = { agents: ["a1", "a2"], tools: ["task", "read"] }
    store.recordNarrowedSets(SESSION, "msg_1", sets)
    expect(store.get(SESSION).narrowedSets).toEqual({ key: "msg_1", sets })
  })

  test("a later turn overwrites the memo with a new key", () => {
    const store = RoutingState.createRoutingSessionStateStore()
    store.recordNarrowedSets(SESSION, "msg_1", { agents: ["a1"] })
    store.recordNarrowedSets(SESSION, "msg_2", { skills: ["s1"] })
    expect(store.get(SESSION).narrowedSets).toEqual({ key: "msg_2", sets: { skills: ["s1"] } })
  })

  test("the memo coexists with other routing-state fields", () => {
    const store = RoutingState.createRoutingSessionStateStore()
    store.recordDecision(
      SESSION,
      { decisionId: "d1", catalogVersion: "1.0.0", policyVersion: "1.0.0" },
      "worker",
    )
    store.recordNarrowedSets(SESSION, "msg_1", { agents: ["a1"] })
    const state = store.get(SESSION)
    expect(state.decision?.decisionId).toBe("d1")
    expect(state.narrowedSets).toEqual({ key: "msg_1", sets: { agents: ["a1"] } })
  })

  test("clear drops the memo alongside the rest of the state", () => {
    const store = RoutingState.createRoutingSessionStateStore()
    store.recordNarrowedSets(SESSION, "msg_1", { agents: ["a1"] })
    store.clear(SESSION)
    expect(store.get(SESSION).narrowedSets).toBeNull()
  })
})
