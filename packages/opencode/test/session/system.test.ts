import { describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import type { Agent } from "../../src/agent/agent"
import { NamedError } from "@opencode-ai/core/util/error"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import type { Provider } from "../../src/provider/provider"
import { SystemPrompt } from "../../src/session/system"
import type { AutoSkillRenderDeps } from "../../src/session/system"
import type { AutoSkillChunkRef } from "../../src/session/routing-state"
import type { OutputSpoolStore } from "../../src/semantic/output-spool-store"
import { MCP } from "../../src/mcp"
import { testEffect } from "../lib/effect"

const localProvenance: Skill.Provenance = { source: "local", autoprime_opt_in: false }

const skills: Skill.Info[] = [
  {
    name: "zeta-skill",
    description: "Zeta skill.",
    location: "/tmp/zeta-skill/SKILL.md",
    content: "# zeta-skill",
    provenance: localProvenance,
  },
  {
    name: "alpha-skill",
    description: "Alpha skill.",
    location: "/tmp/alpha-skill/SKILL.md",
    content: "# alpha-skill",
    provenance: localProvenance,
  },
  {
    name: "middle-skill",
    description: "Middle skill.",
    location: "/tmp/middle-skill/SKILL.md",
    content: "# middle-skill",
    provenance: localProvenance,
  },
  {
    name: "manual-skill",
    location: "/tmp/manual-skill/SKILL.md",
    content: "# manual-skill",
    provenance: localProvenance,
  },
]

const build: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const it = testEffect(
  LayerNode.compile(SystemPrompt.node, [
    [
      MCP.node,
      Layer.mock(MCP.Service, {
        instructions: () =>
          Effect.succeed([
            {
              name: "guide-server",
              instructions: "Use lookup before mutate.",
              tools: [],
            },
            {
              name: "tool-server",
              instructions: "Prefer search before update.",
              tools: ["tool-server_search", "tool-server_update"],
            },
          ]),
      }),
    ],
    [
      Skill.node,
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
          require: (name) => {
            const info = skills.find((skill) => skill.name === name)
            if (info) return Effect.succeed(info)
            return Effect.fail(new Skill.NotFoundError({ name, available: skills.map((skill) => skill.name) }))
          },
          all: () => Effect.succeed(skills),
          dirs: () => Effect.succeed([]),
          available: () => Effect.succeed(skills),
        }),
      ),
    ],
  ]),
)

describe("session.system", () => {
  test("selects the Meta prompt for Muse Spark model IDs", () => {
    expect(SystemPrompt.provider({ api: { id: "meta/muse-spark-preview" } } as Provider.Model)[0]).toContain(
      "Meta Muse Spark",
    )
  })

  it.effect("skills output is sorted by name and stable across calls", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const first = yield* prompt.skills(build)
      const second = yield* prompt.skills(build)
      const output = first ?? (yield* Effect.fail(new NamedError.Unknown({ message: "missing skills output" })))

      expect(first).toBe(second)

      const alpha = output.indexOf("<name>alpha-skill</name>")
      const middle = output.indexOf("<name>middle-skill</name>")
      const zeta = output.indexOf("<name>zeta-skill</name>")

      expect(alpha).toBeGreaterThan(-1)
      expect(middle).toBeGreaterThan(alpha)
      expect(zeta).toBeGreaterThan(middle)
      expect(output).not.toContain("manual-skill")
    }),
  )

  // Feature 051 (T015/T016) — the skills seam. `SystemPrompt.skills` gains an
  // optional `ranked?: readonly string[]` param, narrowed via
  // `ToolRetrieval.narrow` (Feature 009's shared gate primitive) before
  // `Skill.fmt` renders it. An absent `ranked` stays byte-identical.
  it.effect("an absent ranked param is byte-identical to the unranked rendering", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const unranked = yield* prompt.skills(build)
      const explicitlyUndefined = yield* prompt.skills(build, undefined)

      expect(explicitlyUndefined).toBe(unranked)
    }),
  )

  it.effect("a ranked subset narrows the skill list to only the ranked, still-visible names", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.skills(build, ["alpha-skill"])

      expect(output).toContain("<name>alpha-skill</name>")
      expect(output).not.toContain("<name>zeta-skill</name>")
      expect(output).not.toContain("<name>middle-skill</name>")
    }),
  )

  it.effect("a ranked subset never widens the permission-visible set (undescribed skills stay excluded)", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.skills(build, ["manual-skill", "alpha-skill"])

      expect(output).toContain("<name>alpha-skill</name>")
      expect(output).not.toContain("manual-skill")
    }),
  )

  it.effect("an empty ranked list narrows to no skills, never widening to the full set", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.skills(build, [])

      expect(output).toContain("No skills are currently available.")
    }),
  )

  it.effect("ranking never changes Skill.fmt's own rendering logic, only membership/order", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const ranked = yield* prompt.skills(build, ["zeta-skill", "alpha-skill"])
      const unranked = yield* prompt.skills(build)

      // Same tag/attribute shape as the unranked rendering, just narrowed to
      // the ranked names — proves the seam never bypasses `Skill.fmt`.
      expect(ranked).toContain("<available_skills>")
      expect(ranked).toContain("<location>/tmp/alpha-skill/SKILL.md</location>")
      expect(unranked).toContain("<location>/tmp/alpha-skill/SKILL.md</location>")
    }),
  )

  it.effect("MCP output includes connected server instructions", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.mcp(build)

      expect(output).toBe(
        [
          "<mcp_instructions>",
          '  <server name="guide-server">',
          "    Use lookup before mutate.",
          "  </server>",
          '  <server name="tool-server">',
          "    Prefer search before update.",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }),
  )

  it.effect("MCP output omits servers when all advertised tools are denied", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.mcp(build, Permission.fromConfig({ "tool-server_*": "deny" }))

      expect(output).toBe(
        [
          "<mcp_instructions>",
          '  <server name="guide-server">',
          "    Use lookup before mutate.",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }),
  )

  // Feature 052 (T021) — the <auto_skills> render pass: OutputSpool-resolved bodies, the FR4
  // budgets, the FR6 session dedup, and the FR3 dangling-ref skip.
  const ref = (over: Partial<AutoSkillChunkRef> & { chunkId: string; skillName: string; outputRef: string }): AutoSkillChunkRef => ({
    chunkId: over.chunkId,
    skillName: over.skillName,
    score: over.score ?? 0.9,
    bodyRef: { outputRef: over.outputRef, offset: 0, limit: 0 },
  })

  const fakeSpool = (bodies: Record<string, string>): Pick<OutputSpoolStore, "resolve"> => ({
    resolve: (r: string) =>
      r in bodies
        ? Effect.succeed({ body: bodies[r], contentHash: r })
        : Effect.fail({ type: "not_found" as const }),
  })

  const renderDeps = (over: Partial<AutoSkillRenderDeps> & { spool: Pick<OutputSpoolStore, "resolve"> }): AutoSkillRenderDeps => ({
    maxChunks: 10,
    maxTokens: 100_000,
    injected: new Set<string>(),
    record: () => {},
    ...over,
  })

  it.effect("undefined/empty chunks render no block", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const deps = renderDeps({ spool: fakeSpool({}) })
      expect(yield* prompt.autoSkills(build, undefined, deps)).toBeUndefined()
      expect(yield* prompt.autoSkills(build, [], deps)).toBeUndefined()
    }),
  )

  it.effect("renders resolved bodies into an <auto_skills> block", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const chunks = [ref({ chunkId: "a_c0", skillName: "alpha-skill", outputRef: "h0" })]
      const output = yield* prompt.autoSkills(build, chunks, renderDeps({ spool: fakeSpool({ h0: "step one" }) }))
      expect(output).toContain("<auto_skills>")
      expect(output).toContain("<name>alpha-skill</name>")
      expect(output).toContain("<body>step one</body>")
    }),
  )

  it.effect("a dangling ref skips only that chunk; the block still renders from survivors", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const chunks = [
        ref({ chunkId: "a_c0", skillName: "alpha-skill", outputRef: "missing" }),
        ref({ chunkId: "b_c0", skillName: "beta-skill", outputRef: "h1" }),
      ]
      const output = yield* prompt.autoSkills(build, chunks, renderDeps({ spool: fakeSpool({ h1: "beta body" }) }))
      expect(output).toContain("<name>beta-skill</name>")
      expect(output).not.toContain("alpha-skill")
    }),
  )

  it.effect("all-dangling refs render no block (never an empty tag pair)", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const chunks = [ref({ chunkId: "a_c0", skillName: "alpha-skill", outputRef: "missing" })]
      const output = yield* prompt.autoSkills(build, chunks, renderDeps({ spool: fakeSpool({}) }))
      expect(output).toBeUndefined()
    }),
  )

  it.effect("the chunk-count cap truncates the lowest-ranked chunks", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const chunks = [
        ref({ chunkId: "a_c0", skillName: "alpha-skill", outputRef: "h0" }),
        ref({ chunkId: "b_c0", skillName: "beta-skill", outputRef: "h1" }),
      ]
      const output = yield* prompt.autoSkills(
        build,
        chunks,
        renderDeps({ spool: fakeSpool({ h0: "a", h1: "b" }), maxChunks: 1 }),
      )
      expect(output).toContain("<name>alpha-skill</name>")
      expect(output).not.toContain("beta-skill")
    }),
  )

  it.effect("the token cap truncates the lowest-ranked chunks (drop-tail, never partial)", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      // Token.estimate = round(len/4): a 40-char body ≈ 10 tokens; maxTokens 15 fits one, not two.
      const body = "x".repeat(40)
      const chunks = [
        ref({ chunkId: "a_c0", skillName: "alpha-skill", outputRef: "h0" }),
        ref({ chunkId: "b_c0", skillName: "beta-skill", outputRef: "h1" }),
      ]
      const output = yield* prompt.autoSkills(
        build,
        chunks,
        renderDeps({ spool: fakeSpool({ h0: body, h1: body }), maxTokens: 15 }),
      )
      expect(output).toContain("<name>alpha-skill</name>")
      expect(output).not.toContain("beta-skill")
    }),
  )

  it.effect("session dedup excludes an already-injected skill regardless of rank", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const chunks = [
        ref({ chunkId: "a_c0", skillName: "alpha-skill", outputRef: "h0", score: 0.99 }),
        ref({ chunkId: "b_c0", skillName: "beta-skill", outputRef: "h1", score: 0.5 }),
      ]
      const output = yield* prompt.autoSkills(
        build,
        chunks,
        renderDeps({ spool: fakeSpool({ h0: "a", h1: "b" }), injected: new Set(["alpha-skill"]) }),
      )
      expect(output).not.toContain("alpha-skill")
      expect(output).toContain("<name>beta-skill</name>")
    }),
  )

  it.effect("all-deduped chunks render no block", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const chunks = [ref({ chunkId: "a_c0", skillName: "alpha-skill", outputRef: "h0" })]
      const output = yield* prompt.autoSkills(
        build,
        chunks,
        renderDeps({ spool: fakeSpool({ h0: "a" }), injected: new Set(["alpha-skill"]) }),
      )
      expect(output).toBeUndefined()
    }),
  )

  it.effect("a successful render records exactly the rendered skill names and emits debug ids/scores", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const recorded: string[][] = []
      const debug: Array<{ chunkId: string; score: number }> = []
      const chunks = [ref({ chunkId: "a_c0", skillName: "alpha-skill", outputRef: "h0", score: 0.9 })]
      yield* prompt.autoSkills(
        build,
        chunks,
        renderDeps({
          spool: fakeSpool({ h0: "a" }),
          record: (names) => recorded.push([...names]),
          debug: (rows) => debug.push(...rows),
        }),
      )
      expect(recorded).toEqual([["alpha-skill"]])
      expect(debug).toEqual([{ chunkId: "a_c0", score: 0.9 }])
    }),
  )

  it.effect("the skill permission gate suppresses the block (no injection when skill tool is denied)", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const denied: Agent.Info = { ...build, permission: Permission.fromConfig({ skill: "deny" }) }
      const chunks = [ref({ chunkId: "a_c0", skillName: "alpha-skill", outputRef: "h0" })]
      const output = yield* prompt.autoSkills(denied, chunks, renderDeps({ spool: fakeSpool({ h0: "a" }) }))
      expect(output).toBeUndefined()
    }),
  )
})
