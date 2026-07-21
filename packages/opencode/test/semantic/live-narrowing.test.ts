/**
 * Feature 051 / T012 (Phase 2) — the live per-turn narrowing orchestrator.
 *
 * Drives `narrowForTurn` against a fake `RetrievalPort & ToolRetrievalPort` facade and a
 * fake memo store: the gates-off short-circuit (zero I/O), the degenerate-input
 * reuse/passthrough, the per-surface degenerate→`undefined` mapping (zero-hit /
 * revalidation-emptied / dedup-emptied), the fail-open path (rejecting + slow surfaces,
 * exactly one warning), the orchestration-child tools skip, the essential-tool floor merge,
 * the debug log, and the per-turn memoization (FR1–FR8).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type {
  RetrievalRequest,
  RetrievalResult,
  SkillRetrievalRequest,
  ToolRetrievalRequest,
  ToolRetrievalResult,
} from "@opencode-ai/protocol/semantic/commands"
import type { RetrievalPort, ToolRetrievalPort } from "@opencode-ai/protocol/semantic/ports"
import { LiveNarrowing } from "@/semantic/live-narrowing"
import type { NarrowedSets, NarrowedSetsMemo } from "@/session/routing-state"
import type { SessionID } from "@/session/schema"

const SESSION = "ses_live_narrow" as SessionID
const LONG_PROMPT = "how do I configure kubernetes ingress networking with mTLS"

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface Cand {
  readonly id: string
  readonly revalidated?: boolean
}

const agentResult = (cands: readonly Cand[]): RetrievalResult => ({
  candidates: cands.map((c) => ({
    canonicalId: c.id,
    canonicalVersion: "v1",
    kind: "agent",
    score: { denseScore: 1, canonicalId: c.id, canonicalVersion: "v1", confidence: 1 },
    revalidated: c.revalidated ?? true,
  })),
  degradation: { rung: "full" as never },
  queryFingerprint: { fingerprint: "fp", bindingVersion: 1, configHash: "h" },
  cacheHit: false,
})

const toolResult = (cands: readonly Cand[]): ToolRetrievalResult => ({
  candidates: cands.map((c) => ({
    canonicalId: c.id,
    canonicalVersion: "h1",
    source: "native" as never,
    score: { denseScore: 1, canonicalId: c.id, canonicalVersion: "h1", confidence: 1 },
    revalidated: c.revalidated ?? true,
  })),
  degradation: { rung: "full" as never },
  queryFingerprint: { fingerprint: "fp", bindingVersion: 1, configHash: "h" },
  cacheHit: false,
})

type Facade = RetrievalPort & ToolRetrievalPort

type SurfaceBehavior = readonly Cand[] | "throw" | "slow"

interface FakeBehavior {
  readonly agents?: SurfaceBehavior
  readonly skills?: SurfaceBehavior
  readonly tools?: SurfaceBehavior
}

interface FakeFacade {
  readonly retrieval: Facade
  readonly calls: { agents: number; skills: number; tools: number }
}

const surface = <A>(behavior: SurfaceBehavior | undefined, ok: (c: readonly Cand[]) => A): Effect.Effect<A, never> => {
  // Effect.die (a defect) — not Effect.fail — so the effect stays in the `never` error
  // channel and remains assignable to the port signature; runPromise still rejects on it.
  if (behavior === "throw") return Effect.die(new Error("milvus down")) as Effect.Effect<A, never>
  if (behavior === "slow") return Effect.sleep("50 millis").pipe(Effect.as(ok([])))
  return Effect.succeed(ok(behavior ?? []))
}

const fakeFacade = (behavior: FakeBehavior = {}): FakeFacade => {
  const calls = { agents: 0, skills: 0, tools: 0 }
  const retrieval: Facade = {
    retrieveAgents: (_req: RetrievalRequest) => {
      calls.agents++
      return surface(behavior.agents, agentResult)
    },
    retrieveSkills: (_req: SkillRetrievalRequest) => {
      calls.skills++
      return surface(behavior.skills, agentResult)
    },
    retrieveTools: (_req: ToolRetrievalRequest) => {
      calls.tools++
      return surface(behavior.tools, toolResult)
    },
  }
  return { retrieval, calls }
}

const fakeState = (initial: NarrowedSetsMemo | null = null) => {
  let memo = initial
  const writes: Array<{ key: string; sets: NarrowedSets }> = []
  return {
    writes,
    accessors: {
      readMemo: (_s: SessionID) => memo,
      writeMemo: (_s: SessionID, key: string, sets: NarrowedSets) => {
        memo = { key, sets }
        writes.push({ key, sets })
      },
    } satisfies LiveNarrowing.NarrowingStateAccessors,
  }
}

const gates = (over: Partial<LiveNarrowing.NarrowingGates> = {}): LiveNarrowing.NarrowingGates => ({
  agents: true,
  skills: true,
  tools: true,
  minPromptLength: 8,
  latencyBudgetMs: 300,
  debugLog: false,
  ...over,
})

const input = (over: Partial<LiveNarrowing.NarrowForTurnInput> = {}): LiveNarrowing.NarrowForTurnInput => ({
  sessionID: SESSION,
  promptText: LONG_PROMPT,
  lastUserID: "msg_1",
  agent: "build",
  isOrchestrationChild: false,
  ...over,
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("narrowForTurn — gates off", () => {
  test("all gates off returns {} with zero retrieval I/O and no memo write", async () => {
    const facade = fakeFacade({ agents: [{ id: "a1" }] })
    const state = fakeState()
    const sets = await LiveNarrowing.narrowForTurn(
      { gates: gates({ agents: false, skills: false, tools: false }), retrieval: facade.retrieval, state: state.accessors, warn: () => {} },
      input(),
    )
    expect(sets).toEqual({})
    expect(facade.calls).toEqual({ agents: 0, skills: 0, tools: 0 })
    expect(state.writes).toHaveLength(0)
  })

  test("tools gate on but orchestration child, agents/skills off returns {} with no I/O", async () => {
    const facade = fakeFacade()
    const state = fakeState()
    const sets = await LiveNarrowing.narrowForTurn(
      { gates: gates({ agents: false, skills: false, tools: true }), retrieval: facade.retrieval, state: state.accessors, warn: () => {} },
      input({ isOrchestrationChild: true }),
    )
    expect(sets).toEqual({})
    expect(facade.calls).toEqual({ agents: 0, skills: 0, tools: 0 })
  })
})

describe("narrowForTurn — degenerate input", () => {
  test("short first turn (no memo) returns passthrough without embedding", async () => {
    const facade = fakeFacade({ agents: [{ id: "a1" }] })
    const state = fakeState()
    const sets = await LiveNarrowing.narrowForTurn(
      { gates: gates(), retrieval: facade.retrieval, state: state.accessors, warn: () => {} },
      input({ promptText: "yes" }),
    )
    expect(sets).toEqual({})
    expect(facade.calls).toEqual({ agents: 0, skills: 0, tools: 0 })
  })

  test("short follow-up reuses the prior memo verbatim without embedding", async () => {
    const prior: NarrowedSetsMemo = { key: "msg_0", sets: { agents: ["a1"], tools: ["task", "read"] } }
    const facade = fakeFacade({ agents: [{ id: "zzz" }] })
    const state = fakeState(prior)
    const sets = await LiveNarrowing.narrowForTurn(
      { gates: gates(), retrieval: facade.retrieval, state: state.accessors, warn: () => {} },
      input({ promptText: "ok", lastUserID: "msg_1" }),
    )
    expect(sets).toEqual(prior.sets)
    expect(facade.calls).toEqual({ agents: 0, skills: 0, tools: 0 })
  })
})

describe("narrowForTurn — memoization", () => {
  test("second call with the same lastUser.id returns the memo without re-retrieving", async () => {
    const facade = fakeFacade({ agents: [{ id: "a1" }], skills: [{ id: "s1" }], tools: [{ id: "grep" }] })
    const state = fakeState()
    const deps = { gates: gates(), retrieval: facade.retrieval, state: state.accessors, warn: () => {} }
    const first = await LiveNarrowing.narrowForTurn(deps, input())
    const second = await LiveNarrowing.narrowForTurn(deps, input())
    expect(second).toEqual(first)
    expect(facade.calls).toEqual({ agents: 1, skills: 1, tools: 1 })
  })
})

describe("narrowForTurn — per-surface degenerate → undefined", () => {
  test("zero hits maps to passthrough (undefined) for that surface", async () => {
    const facade = fakeFacade({ agents: [], skills: [{ id: "s1" }], tools: [] })
    const state = fakeState()
    const sets = await LiveNarrowing.narrowForTurn(
      { gates: gates(), retrieval: facade.retrieval, state: state.accessors, warn: () => {} },
      input(),
    )
    expect(sets.agents).toBeUndefined()
    expect(sets.skills).toEqual(["s1"])
    expect(sets.tools).toBeUndefined()
  })

  test("a set emptied entirely by revalidation maps to undefined", async () => {
    const facade = fakeFacade({ agents: [{ id: "a1", revalidated: false }, { id: "a2", revalidated: false }] })
    const state = fakeState()
    const sets = await LiveNarrowing.narrowForTurn(
      { gates: gates({ skills: false, tools: false }), retrieval: facade.retrieval, state: state.accessors, warn: () => {} },
      input(),
    )
    expect(sets.agents).toBeUndefined()
  })

  test("a set emptied by dedup keeps the single surviving id", async () => {
    const facade = fakeFacade({ agents: [{ id: "a1" }, { id: "a1" }, { id: "a1" }] })
    const state = fakeState()
    const sets = await LiveNarrowing.narrowForTurn(
      { gates: gates({ skills: false, tools: false }), retrieval: facade.retrieval, state: state.accessors, warn: () => {} },
      input(),
    )
    expect(sets.agents).toEqual(["a1"])
  })
})

describe("narrowForTurn — fail-open", () => {
  test("a rejecting surface passes through; a healthy surface still ranks; one warning", async () => {
    const warnings: string[] = []
    const facade = fakeFacade({ agents: "throw", skills: [{ id: "s1" }], tools: "throw" })
    const state = fakeState()
    const sets = await LiveNarrowing.narrowForTurn(
      { gates: gates(), retrieval: facade.retrieval, state: state.accessors, warn: (m) => warnings.push(m) },
      input(),
    )
    expect(sets.agents).toBeUndefined()
    expect(sets.skills).toEqual(["s1"])
    expect(sets.tools).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })

  test("a slow surface trips the shared deadline and passes through", async () => {
    const warnings: string[] = []
    const facade = fakeFacade({ agents: "slow", skills: [{ id: "s1" }] })
    const state = fakeState()
    const sets = await LiveNarrowing.narrowForTurn(
      {
        gates: gates({ tools: false, latencyBudgetMs: 5 }),
        retrieval: facade.retrieval,
        state: state.accessors,
        warn: (m) => warnings.push(m),
      },
      input(),
    )
    expect(sets.agents).toBeUndefined()
    expect(sets.skills).toEqual(["s1"])
    expect(warnings).toHaveLength(1)
  })
})

describe("narrowForTurn — orchestration child", () => {
  test("tools retrieval is skipped entirely; agents/skills still narrow", async () => {
    const facade = fakeFacade({ agents: [{ id: "a1" }], skills: [{ id: "s1" }], tools: [{ id: "grep" }] })
    const state = fakeState()
    const sets = await LiveNarrowing.narrowForTurn(
      { gates: gates(), retrieval: facade.retrieval, state: state.accessors, warn: () => {} },
      input({ isOrchestrationChild: true }),
    )
    expect(facade.calls.tools).toBe(0)
    expect(sets.tools).toBeUndefined()
    expect(sets.agents).toEqual(["a1"])
    expect(sets.skills).toEqual(["s1"])
  })
})

describe("narrowForTurn — essential-tool floor", () => {
  test("the floor is unioned into a narrowed tools set (ranked first, floor appended, no dups)", async () => {
    const facade = fakeFacade({ tools: [{ id: "grep" }, { id: "mytool" }] })
    const state = fakeState()
    const sets = await LiveNarrowing.narrowForTurn(
      { gates: gates({ agents: false, skills: false }), retrieval: facade.retrieval, state: state.accessors, warn: () => {} },
      input(),
    )
    // ranked order preserved first (grep, mytool), then the missing floor ids, grep not duplicated
    expect(sets.tools?.slice(0, 2)).toEqual(["grep", "mytool"])
    for (const id of LiveNarrowing.ESSENTIAL_TOOL_FLOOR) expect(sets.tools).toContain(id)
    expect(new Set(sets.tools).size).toBe(sets.tools!.length)
  })

  test("mergeFloor keeps ranked order, appends missing floor ids, and dedups", () => {
    const merged = LiveNarrowing.mergeFloor(["grep", "custom"])
    expect(merged.slice(0, 2)).toEqual(["grep", "custom"])
    expect(merged).toContain("task")
    expect(merged.filter((id) => id === "grep")).toHaveLength(1)
  })
})

describe("narrowForTurn — debug log", () => {
  test("debug_log emits kept/dropped canonical ids per surface", async () => {
    const logged: Array<{ surface: string; kept: readonly string[]; dropped: readonly string[] }> = []
    const facade = fakeFacade({
      agents: [{ id: "a1" }, { id: "a2", revalidated: false }],
    })
    const state = fakeState()
    await LiveNarrowing.narrowForTurn(
      {
        gates: gates({ skills: false, tools: false, debugLog: true }),
        retrieval: facade.retrieval,
        state: state.accessors,
        warn: () => {},
        debugLog: (surface, kept, dropped) => logged.push({ surface, kept, dropped }),
      },
      input(),
    )
    const agents = logged.find((entry) => entry.surface === "agents")
    expect(agents?.kept).toEqual(["a1"])
    expect(agents?.dropped).toEqual(["a2"])
  })
})

describe("isOrchestrationChildRuleset", () => {
  test("matches a leading deny-* plus allow-only ruleset", () => {
    const rules = [
      { permission: "*", pattern: "*", action: "deny" as const },
      { permission: "read", pattern: "*", action: "allow" as const },
      { permission: "task", pattern: "*", action: "allow" as const },
    ]
    expect(LiveNarrowing.isOrchestrationChildRuleset(rules)).toBe(true)
  })

  test("rejects an empty ruleset and a non-deny head", () => {
    expect(LiveNarrowing.isOrchestrationChildRuleset([])).toBe(false)
    expect(
      LiveNarrowing.isOrchestrationChildRuleset([{ permission: "*", pattern: "*", action: "allow" }]),
    ).toBe(false)
  })
})
