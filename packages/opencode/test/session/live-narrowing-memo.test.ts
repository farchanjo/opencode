/**
 * Feature 051 / T021 (FR1) — memoization across runLoop steps.
 *
 * The per-turn call site (`session/prompt.ts`) resolves ONE `narrowForTurn` pass and
 * threads its `NarrowedSets` into all three seams (`sys.skills` skills, the tools gate,
 * `describeTask` agents). Because `SessionTools.resolve`/`sys.skills` run once per
 * tool-call round trip, a naive re-resolution could mutate the visible set mid-turn.
 * This test drives the SAME store→accessor bridge the call site uses
 * (`LiveNarrowing.narrowingAccessors` over the shared `RoutingSessionStateStore`) and
 * proves that two round trips of the same turn (same `lastUser.id`) read the identical
 * `NarrowedSets` while the retrieval facade is invoked exactly once (FR1).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LiveNarrowing } from "@/semantic/live-narrowing"
import { createRoutingSessionStateStore } from "@/session/routing-state"
import type { SessionID } from "@/session/schema"
import type { RetrievalPort, ToolRetrievalPort } from "@opencode-ai/protocol/semantic/ports"
import type {
  RetrievalRequest,
  RetrievalResult,
  SkillRetrievalRequest,
  ToolRetrievalRequest,
  ToolRetrievalResult,
} from "@opencode-ai/protocol/semantic/commands"

const SESSION = "ses_memo" as SessionID
const LONG_PROMPT = "how do I configure kubernetes ingress networking with mTLS"

const agentResult = (ids: readonly string[]): RetrievalResult => ({
  candidates: ids.map((id) => ({
    canonicalId: id,
    canonicalVersion: "v1",
    kind: "agent",
    score: { denseScore: 1, canonicalId: id, canonicalVersion: "v1", confidence: 1 },
    revalidated: true,
  })),
  degradation: { rung: "full" as never },
  queryFingerprint: { fingerprint: "fp", bindingVersion: 1, configHash: "h" },
  cacheHit: false,
})

const toolResult = (ids: readonly string[]): ToolRetrievalResult => ({
  candidates: ids.map((id) => ({
    canonicalId: id,
    canonicalVersion: "h1",
    source: "native" as never,
    score: { denseScore: 1, canonicalId: id, canonicalVersion: "h1", confidence: 1 },
    revalidated: true,
  })),
  degradation: { rung: "full" as never },
  queryFingerprint: { fingerprint: "fp", bindingVersion: 1, configHash: "h" },
  cacheHit: false,
})

const countingFacade = () => {
  const calls = { agents: 0, skills: 0, tools: 0 }
  const retrieval: RetrievalPort & ToolRetrievalPort = {
    retrieveAgents: (_r: RetrievalRequest) => {
      calls.agents++
      return Effect.succeed(agentResult(["reviewer", "researcher"]))
    },
    retrieveSkills: (_r: SkillRetrievalRequest) => {
      calls.skills++
      return Effect.succeed(agentResult(["mermaid"]))
    },
    retrieveTools: (_r: ToolRetrievalRequest) => {
      calls.tools++
      return Effect.succeed(toolResult(["grep"]))
    },
  }
  return { retrieval, calls }
}

const GATES: LiveNarrowing.NarrowingGates = {
  agents: true,
  skills: true,
  tools: true,
  minPromptLength: 8,
  latencyBudgetMs: 300,
  debugLog: false,
}

const turn = (lastUserID: string) => ({
  sessionID: SESSION,
  promptText: LONG_PROMPT,
  lastUserID,
  agent: "build",
  isOrchestrationChild: false,
})

describe("live narrowing — memoization across runLoop steps (FR1)", () => {
  test("two same-turn passes read identical sets and hit the facade exactly once", async () => {
    const store = createRoutingSessionStateStore()
    const state = LiveNarrowing.narrowingAccessors(store)
    const facade = countingFacade()
    const deps = { gates: GATES, retrieval: facade.retrieval, state, warn: () => {} }

    const first = await LiveNarrowing.narrowForTurn(deps, turn("msg_1"))
    const second = await LiveNarrowing.narrowForTurn(deps, turn("msg_1"))

    // FR1 — the retrieval facade is embedded/recalled ONCE for the whole turn.
    expect(facade.calls).toEqual({ agents: 1, skills: 1, tools: 1 })
    // Both round trips see the identical narrowed sets (tool-set stability).
    expect(second).toEqual(first)
    expect(first.agents).toEqual(["reviewer", "researcher"])
    expect(first.skills).toEqual(["mermaid"])
    // The tools surface merges the essential-tool floor around the ranked hit.
    expect(first.tools).toContain("grep")
    for (const floor of LiveNarrowing.ESSENTIAL_TOOL_FLOOR) expect(first.tools).toContain(floor)
  })

  test("the memo is persisted in the shared routing store keyed by lastUser.id", async () => {
    const store = createRoutingSessionStateStore()
    const state = LiveNarrowing.narrowingAccessors(store)
    const facade = countingFacade()

    const sets = await LiveNarrowing.narrowForTurn(
      { gates: GATES, retrieval: facade.retrieval, state, warn: () => {} },
      turn("msg_42"),
    )

    const memo = store.get(SESSION).narrowedSets
    expect(memo?.key).toBe("msg_42")
    expect(memo?.sets).toEqual(sets)
  })

  test("a new turn (new lastUser.id) recomputes — one fresh retrieval round", async () => {
    const store = createRoutingSessionStateStore()
    const state = LiveNarrowing.narrowingAccessors(store)
    const facade = countingFacade()
    const deps = { gates: GATES, retrieval: facade.retrieval, state, warn: () => {} }

    await LiveNarrowing.narrowForTurn(deps, turn("msg_1"))
    await LiveNarrowing.narrowForTurn(deps, turn("msg_1")) // memo hit
    await LiveNarrowing.narrowForTurn(deps, turn("msg_2")) // new turn

    expect(facade.calls).toEqual({ agents: 2, skills: 2, tools: 2 })
    expect(store.get(SESSION).narrowedSets?.key).toBe("msg_2")
  })
})
