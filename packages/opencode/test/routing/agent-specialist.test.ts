/**
 * Feature 001 / T031 — specialist-agent resolution for the Smart Routing
 * two-stage pipeline (task -> specialist agent -> executor model), wired onto
 * the canonical config-composed Agent registry (packages/opencode/src/agent/agent.ts)
 * — the same registry `TaskTool` dispatches subagents through. No hardcoded
 * agent IDs: the candidate pool and resolution both read the live registry.
 */
import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { Skill } from "@/skill"

const agentLayer = () =>
  LayerNode.compile(
    LayerNode.group([Agent.node, Plugin.node, Provider.node, Auth.node, Config.node, Skill.node, RuntimeFlags.node]),
    [[RuntimeFlags.node, RuntimeFlags.layer({})]],
  )

const it = testEffect(agentLayer())

function load<A>(fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Agent.Service.use(fn)
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("T031 Agent.resolveSpecialist / listSpecialists", () => {
  it.instance("resolveSpecialist returns a registered, non-hidden agent by id", () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.resolveSpecialist("build"))
      expect(build).toBeDefined()
      expect(build?.name).toBe("build")

      const explore = yield* load((svc) => svc.resolveSpecialist("explore"))
      expect(explore).toBeDefined()
      expect(explore?.mode).toBe("subagent")
    }),
  )

  it.instance("resolveSpecialist returns undefined for an unknown agent id", () =>
    Effect.gen(function* () {
      const missing = yield* load((svc) => svc.resolveSpecialist("does_not_exist"))
      expect(missing).toBeUndefined()
    }),
  )

  it.instance("resolveSpecialist never resolves a hidden internal agent", () =>
    Effect.gen(function* () {
      const compaction = yield* load((svc) => svc.resolveSpecialist("compaction"))
      expect(compaction).toBeUndefined()
      const title = yield* load((svc) => svc.resolveSpecialist("title"))
      expect(title).toBeUndefined()
      const summary = yield* load((svc) => svc.resolveSpecialist("summary"))
      expect(summary).toBeUndefined()
    }),
  )

  it.instance("listSpecialists excludes hidden internal agents but includes native primary/subagent entries", () =>
    Effect.gen(function* () {
      const specialists = yield* load((svc) => svc.listSpecialists())
      const names = specialists.map((agent) => agent.name)
      expect(names).toContain("build")
      expect(names).toContain("plan")
      expect(names).toContain("general")
      expect(names).toContain("explore")
      expect(names).not.toContain("compaction")
      expect(names).not.toContain("title")
      expect(names).not.toContain("summary")
      expect(specialists.every((agent) => !agent.hidden)).toBe(true)
    }),
  )

  it.instance(
    "listSpecialists picks up a custom agent from config with no hardcoded id",
    () =>
      Effect.gen(function* () {
        const specialists = yield* load((svc) => svc.listSpecialists())
        const names = specialists.map((agent) => agent.name)
        expect(names).toContain("routing_probe_agent")

        const resolved = yield* load((svc) => svc.resolveSpecialist("routing_probe_agent"))
        expect(resolved?.description).toBe("Routing specialist probe")
      }),
    {
      config: {
        agent: {
          routing_probe_agent: {
            description: "Routing specialist probe",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance(
    "an agent hidden via config is excluded from the specialist pool",
    () =>
      Effect.gen(function* () {
        const hidden = yield* load((svc) => svc.resolveSpecialist("explore"))
        expect(hidden).toBeUndefined()
        const specialists = yield* load((svc) => svc.listSpecialists())
        expect(specialists.map((agent) => agent.name)).not.toContain("explore")
      }),
    {
      config: {
        agent: {
          explore: { hidden: true },
        },
      },
    },
  )
})
