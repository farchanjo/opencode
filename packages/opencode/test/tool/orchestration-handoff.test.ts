import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionID } from "../../src/session/schema"
import type { SessionPrompt } from "../../src/session/prompt"
import { OrchestrationHandoff } from "../../src/tool/orchestration-handoff"

// =============================================================================
// Fakes
// =============================================================================

interface PromptCall {
  readonly agentName: string
  readonly sessionID: SessionID
  readonly text: string
}

type Script = Record<string, string | "fail" | "never">

/** A fake `SyntheticSessionOps` that records the order of `prompt` calls, tracks which
 * sessions were stamped synthetic, and asserts (structurally) that a session is stamped
 * BEFORE its own `prompt` runs (FR5). */
function makeSessionOps(script: Script) {
  const order: PromptCall[] = []
  const synthetic: SessionID[] = []
  let counter = 0
  const partsText = (parts: SessionPrompt.PromptInput["parts"]): string => {
    const first = parts[0]
    return first && first.type === "text" ? first.text : ""
  }
  const ops: OrchestrationHandoff.SyntheticSessionOps = {
    createSession: (agentName) => Effect.sync(() => SessionID.make(`ses_${agentName}_${counter++}`)),
    markSynthetic: (sessionId) => {
      synthetic.push(sessionId)
    },
    resolvePromptParts: (template) => Effect.succeed([{ type: "text", text: template }] as SessionPrompt.PromptInput["parts"]),
    prompt: ({ sessionID, agentName, parts }) => {
      if (!synthetic.includes(sessionID)) throw new Error(`prompt ran before synthetic stamp for ${sessionID}`)
      order.push({ agentName, sessionID, text: partsText(parts) })
      const outcome = script[agentName]
      // A stage failure surfaces as a defect on the E=never turn (runInterception's
      // `catchCause` absorbs failures AND defects into a degrade, FR4).
      if (outcome === "fail")
        return Effect.sync((): string => {
          throw new Error(`stage ${agentName} failed`)
        })
      if (outcome === "never") return Effect.never
      return Effect.succeed(outcome ?? "")
    },
  }
  return { ops, order, synthetic }
}

const SPECIALISTS: readonly OrchestrationHandoff.SpecialistLite[] = [
  { name: "golang-pro", description: "Go" },
  { name: "typescript-pro", description: "TS" },
]

function makeDeps(
  overrides: Partial<OrchestrationHandoff.InterceptionDeps> & { readonly sessionOps: OrchestrationHandoff.SyntheticSessionOps },
): OrchestrationHandoff.InterceptionDeps {
  return {
    dataAgentName: "explore",
    composerAgentName: "manager-composer",
    resolveAgent: (name) => Effect.succeed(name === "unknown-agent" ? undefined : { name }),
    retrieveRanked: () => Effect.succeed([] as readonly string[]),
    listSpecialists: () => Effect.succeed(SPECIALISTS),
    now: () => 0,
    ...overrides,
  }
}

const run = <A>(effect: Effect.Effect<A>): Promise<A> => Effect.runPromise(effect)

// =============================================================================
// interceptionEligible (FR5) — truth table
// =============================================================================

describe("interceptionEligible", () => {
  test("Feature 056 — always false (no Manager-child handoff)", () => {
    expect(OrchestrationHandoff.interceptionEligible("manager", true, false)).toBe(false)
    expect(OrchestrationHandoff.interceptionEligible("manager", true, true)).toBe(false)
    expect(OrchestrationHandoff.interceptionEligible("manager", false, false)).toBe(false)
    expect(OrchestrationHandoff.interceptionEligible("worker", true, false)).toBe(false)
    expect(OrchestrationHandoff.interceptionEligible("architect", true, false)).toBe(false)
  })
})

// =============================================================================
// spawnSyntheticSubSession (FR2, FR5)
// =============================================================================

describe("spawnSyntheticSubSession", () => {
  test("stamps synthetic BEFORE the turn runs and returns the turn text", async () => {
    const { ops, order, synthetic } = makeSessionOps({ explore: "recon result" })
    const result = await run(OrchestrationHandoff.spawnSyntheticSubSession(ops, "explore", "recon prompt"))
    expect(result.resultText).toBe("recon result")
    expect(synthetic).toContain(result.sessionId)
    expect(order[0]?.agentName).toBe("explore")
    expect(order[0]?.text).toBe("recon prompt")
  })
})

// =============================================================================
// runInterception (FR2, FR3, FR4, FR6, FR7)
// =============================================================================

describe("runInterception", () => {
  test("Data precedes Composer and the validated brief becomes the promptOverride", async () => {
    const brief = "- [build the parser] → specialist: golang-pro"
    const { ops, order } = makeSessionOps({ explore: "recon", "manager-composer": brief })
    const result = await run(OrchestrationHandoff.runInterception(makeDeps({ sessionOps: ops }), { intent: "task" }))

    expect(order.map((c) => c.agentName)).toEqual(["explore", "manager-composer"])
    expect(result.promptOverride).toBe(brief)
    expect(result.log.stages.map((s) => s.result)).toEqual(["ran", "ran"])
    expect(result.log.tally).toEqual({ repaired: 0, flagged: 0 })
  })

  test("an unbound composer_agent skips the whole interception (no spawn, byte-identical)", async () => {
    const { ops, order } = makeSessionOps({ explore: "recon" })
    const deps = makeDeps({ sessionOps: ops, composerAgentName: undefined })
    const result = await run(OrchestrationHandoff.runInterception(deps, { intent: "task" }))

    expect(order).toHaveLength(0)
    expect(result.promptOverride).toBeUndefined()
    expect(result.log.stages.map((s) => s.result)).toEqual(["skipped", "skipped"])
  })

  test("an unresolvable data binding skips the interception", async () => {
    const { ops, order } = makeSessionOps({})
    const deps = makeDeps({ sessionOps: ops, dataAgentName: "unknown-agent" })
    const result = await run(OrchestrationHandoff.runInterception(deps, { intent: "task" }))

    expect(order).toHaveLength(0)
    expect(result.promptOverride).toBeUndefined()
    expect(result.log.stages.map((s) => s.result)).toEqual(["skipped", "skipped"])
  })

  test("a Data failure degrades the whole interception; Composer never runs", async () => {
    const { ops, order } = makeSessionOps({ explore: "fail", "manager-composer": "brief" })
    const result = await run(OrchestrationHandoff.runInterception(makeDeps({ sessionOps: ops }), { intent: "task" }))

    expect(order.map((c) => c.agentName)).toEqual(["explore"])
    expect(result.promptOverride).toBeUndefined()
    expect(result.log.stages).toEqual([{ stage: "data", result: "degraded", durationMs: 0 }])
  })

  test("a Composer timeout degrades the whole interception (no partial brief)", async () => {
    const { ops } = makeSessionOps({ explore: "recon", "manager-composer": "never" })
    const deps = makeDeps({ sessionOps: ops, deadlineMs: 20 })
    const result = await run(OrchestrationHandoff.runInterception(deps, { intent: "task" }))

    expect(result.promptOverride).toBeUndefined()
    expect(result.log.stages.map((s) => s.result)).toEqual(["ran", "degraded"])
  })

  test("catalog fail-open: a retrieval failure falls back to the full live registry names", async () => {
    const { ops, order } = makeSessionOps({ explore: "recon", "manager-composer": "brief" })
    const deps = makeDeps({
      sessionOps: ops,
      retrieveRanked: () =>
        Effect.sync((): readonly string[] => {
          throw new Error("retrieval down")
        }),
    })
    await run(OrchestrationHandoff.runInterception(deps, { intent: "task" }))

    const composerPrompt = order.find((c) => c.agentName === "manager-composer")?.text ?? ""
    expect(composerPrompt).toContain("golang-pro")
    expect(composerPrompt).toContain("typescript-pro")
  })

  test("catalog retrieval timeout (FR3/FR4 defense-in-depth): a hung retrieveRanked degrades to the full live registry within its own short deadline, never stalling the interception", async () => {
    const { ops, order } = makeSessionOps({ explore: "recon", "manager-composer": "brief" })
    const deps = makeDeps({
      sessionOps: ops,
      retrieveRanked: () => Effect.never,
      catalogDeadlineMs: 20,
    })
    const result = await run(OrchestrationHandoff.runInterception(deps, { intent: "task" }))

    const composerPrompt = order.find((c) => c.agentName === "manager-composer")?.text ?? ""
    expect(composerPrompt).toContain("golang-pro")
    expect(composerPrompt).toContain("typescript-pro")
    expect(result.log.stages.map((s) => s.result)).toEqual(["ran", "ran"])
  })

  test("catalog retrieval timeout: a hung listSpecialists also degrades within its own short deadline", async () => {
    const { ops } = makeSessionOps({ explore: "recon", "manager-composer": "brief" })
    const deps = makeDeps({
      sessionOps: ops,
      listSpecialists: () => Effect.never,
      catalogDeadlineMs: 20,
    })
    const start = Date.now()
    const result = await run(OrchestrationHandoff.runInterception(deps, { intent: "task" }))
    expect(Date.now() - start).toBeLessThan(1000)
    expect(result.log.stages.map((s) => s.result)).toEqual(["ran", "ran"])
  })

  test("a fresh ranked catalog orders the Composer catalog by the retrieval ranking", async () => {
    const { ops, order } = makeSessionOps({ explore: "recon", "manager-composer": "brief" })
    const deps = makeDeps({
      sessionOps: ops,
      retrieveRanked: () => Effect.succeed(["typescript-pro"] as readonly string[]),
    })
    await run(OrchestrationHandoff.runInterception(deps, { intent: "task" }))

    const composerPrompt = order.find((c) => c.agentName === "manager-composer")?.text ?? ""
    expect(composerPrompt).toContain("- typescript-pro: TS")
  })

  test("a hallucinated specialist with an unambiguous ranked substitute is repaired in the tally", async () => {
    const brief = "- [write the client] → specialist: golang-pr"
    const { ops } = makeSessionOps({ explore: "recon", "manager-composer": brief })
    const deps = makeDeps({
      sessionOps: ops,
      retrieveRanked: () => Effect.succeed(["golang-pro"] as readonly string[]),
    })
    const result = await run(OrchestrationHandoff.runInterception(deps, { intent: "task" }))

    expect(result.promptOverride).toContain("golang-pro")
    expect(result.log.tally?.repaired).toBe(1)
    expect(result.log.tally?.flagged).toBe(0)
  })
})
