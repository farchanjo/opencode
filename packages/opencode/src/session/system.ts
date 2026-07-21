import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Option } from "effect"

import { InstanceState } from "@/effect/instance-state"
import { Token } from "@opencode-ai/core/util/token"
import type { AutoSkillChunkRef } from "@/session/routing-state"
import type { OutputSpoolStore } from "@/semantic/output-spool-store"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"
import PROMPT_META from "./prompt/meta.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Reference } from "@opencode-ai/core/reference"
import { MCP } from "@/mcp"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { ToolRetrieval } from "@/semantic/tool-retrieval"

export function provider(model: Provider.Model) {
  if (model.api.id.includes("muse-spark")) return [PROMPT_META]
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (
    agent: Agent.Info,
    /** Feature 051 — the turn's ranked, revalidated skill-id subset (FR4, skills
     * seam). Absent → the full permission-visible skill list renders unchanged
     * (the full-set passthrough floor). Tier-1 listing only — never spends
     * `max_skill_chunks`/`max_skill_tokens`. */
    ranked?: readonly string[],
  ) => Effect.Effect<string | undefined>
  readonly mcp: (agent: Agent.Info, permission?: PermissionV1.Ruleset) => Effect.Effect<string | undefined>
  /** Feature 052 (FR3, FR4, FR6) — render the turn's qualifying skill chunks into an
   * `<auto_skills>` Tier-2 block. Bodies resolve ONLY through `OutputSpoolStore.resolve`; a
   * dangling/superseded ref skips that one chunk silently. Bounded by `deps.maxChunks`/
   * `deps.maxTokens`, filtered against the session dedup set, and `undefined` (no block) when
   * nothing qualifies — never an empty tag pair, never a Tier-1 change. */
  readonly autoSkills: (
    agent: Agent.Info,
    chunks: readonly AutoSkillChunkRef[] | undefined,
    deps: AutoSkillRenderDeps,
  ) => Effect.Effect<string | undefined>
}

/** Feature 052 — the per-call render dependencies for `SystemPrompt.autoSkills`: the Feature 050
 * content plane, the FR4 budgets, the FR6 session dedup set + recorder, and the FR8 debug sink.
 * Passed per turn (never layer-captured) so the session-scoped dedup state stays per-session. */
export interface AutoSkillRenderDeps {
  readonly spool: Pick<OutputSpoolStore, "resolve">
  readonly maxChunks: number
  readonly maxTokens: number
  /** The skill names already auto-injected earlier this session — filtered out before any I/O (FR6). */
  readonly injected: ReadonlySet<string>
  /** Record the skill names actually rendered, extending the session dedup set (FR6). */
  readonly record: (skillNames: readonly string[]) => void
  /** Opt-in, content-free debug sink: injected chunk ids + scores only, never body/prompt text (FR8). */
  readonly debug?: (rows: readonly { readonly chunkId: string; readonly score: number }[]) => void
}

/** Render the resolved survivors into the `<auto_skills>` block (mirrors `Skill.fmt`'s convention). Pure. */
function renderAutoSkillsBlock(rows: readonly { readonly skillName: string; readonly body: string }[]): string {
  return [
    "These skills were auto-selected for this turn; their guidance is already loaded below.",
    "<auto_skills>",
    ...rows.flatMap((row) => [
      "  <skill>",
      `    <name>${row.skillName}</name>`,
      `    <body>${row.body}</body>`,
      "  </skill>",
    ]),
    "</auto_skills>",
  ].join("\n")
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const mcp = yield* MCP.Service
    const locations = yield* LocationServiceMap.Service

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        const references = yield* Effect.gen(function* () {
          return (yield* (yield* Reference.Service).list()).filter((reference) => reference.description !== undefined)
        }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))))
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
          references.length === 0
            ? undefined
            : [
                "Project references provide additional directories that can be accessed when relevant.",
                "<available_references>",
                ...references
                  .toSorted((a, b) => a.name.localeCompare(b.name))
                  .flatMap((reference) => [
                    "  <reference>",
                    `    <name>${reference.name}</name>`,
                    `    <path>${reference.path}</path>`,
                    ...(reference.description === undefined
                      ? []
                      : [`    <description>${reference.description}</description>`]),
                    "  </reference>",
                  ]),
                "</available_references>",
              ].join("\n"),
        ].filter((part): part is string => part !== undefined)
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info, ranked?: readonly string[]) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const available = yield* skill.available(agent)
        const gate: ToolRetrieval.RankedGate = { enabled: ranked !== undefined, ranked }
        const list = [...ToolRetrieval.narrow(available, (item) => item.name, gate)]

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),

      autoSkills: Effect.fn("SystemPrompt.autoSkills")(function* (
        agent: Agent.Info,
        chunks: readonly AutoSkillChunkRef[] | undefined,
        deps: AutoSkillRenderDeps,
      ) {
        if (!chunks || chunks.length === 0) return undefined
        // Same permission gate `skills` performs: content reaching <auto_skills> is content the
        // model could already load via the `skill` tool under this exact check (FR5 security).
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return undefined

        // FR6 — drop any skill already injected this session BEFORE resolving a single body.
        const eligible = chunks.filter((chunk) => !deps.injected.has(chunk.skillName))
        const rendered: Array<{ readonly chunk: AutoSkillChunkRef; readonly body: string }> = []
        let tokens = 0
        for (const chunk of eligible) {
          if (rendered.length >= deps.maxChunks) break // FR4 — chunk-count cap
          const resolved = yield* deps.spool.resolve(chunk.bodyRef.outputRef).pipe(Effect.option)
          if (Option.isNone(resolved)) continue // FR3/FR8 — dangling/superseded ref skips this one chunk
          const next = tokens + Token.estimate(resolved.value.body)
          if (next > deps.maxTokens) break // FR4 — token cap; drop the lowest-ranked remaining first
          tokens = next
          rendered.push({ chunk, body: resolved.value.body })
        }
        if (rendered.length === 0) return undefined

        deps.record([...new Set(rendered.map((row) => row.chunk.skillName))]) // FR6
        deps.debug?.(rendered.map((row) => ({ chunkId: row.chunk.chunkId, score: row.chunk.score }))) // FR8
        return renderAutoSkillsBlock(rendered.map((row) => ({ skillName: row.chunk.skillName, body: row.body })))
      }),

      mcp: Effect.fn("SystemPrompt.mcp")(function* (agent: Agent.Info, permission?: PermissionV1.Ruleset) {
        const ruleset = Permission.merge(agent.permission, permission ?? [])
        const instructions = (yield* mcp.instructions()).filter(
          (item) => item.tools.length === 0 || Permission.disabled(item.tools, ruleset).size < item.tools.length,
        )
        if (instructions.length === 0) return

        return [
          "<mcp_instructions>",
          ...instructions.flatMap((item) => [
            `  <server name="${item.name}">`,
            ...item.instructions.split("\n").map((line) => `    ${line}`),
            "  </server>",
          ]),
          "</mcp_instructions>",
        ].join("\n")
      }),
    })
  }),
)

const locationServiceMapNode = LayerNode.make({
  service: LocationServiceMap.Service,
  layer: locationServiceMapLayer,
  deps: [],
})

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Skill.node, MCP.node, locationServiceMapNode],
})

export * as SystemPrompt from "./system"
