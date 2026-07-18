import { describe, expect, test } from "bun:test"
import { createMemoryConfigPort } from "@/operator/adapters"
import {
  ConfigAdapter,
  createConfigAdapter,
  toRoutingConfigSource,
  DEFAULT_ROUTING_CONFIG,
  policyVersionOf,
} from "@/routing/adapters/outbound/config-adapter"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"

function projectConfig(overrides: Partial<RoutingConfig.Info["activation"]> = {}): RoutingConfig.Info {
  return {
    ...DEFAULT_ROUTING_CONFIG,
    activation: { ...DEFAULT_ROUTING_CONFIG.activation, enabled: true, mode: "always", ...overrides },
    models: { ...DEFAULT_ROUTING_CONFIG.models, role_pools: { worker: ["gpt-5"] } },
  }
}

describe("ConfigAdapter.createConfigAdapter", () => {
  test("exports the namespace object", () => {
    expect(typeof ConfigAdapter.createConfigAdapter).toBe("function")
  })

  test("resolveEffective falls back to the safe, disabled-by-default RoutingConfig when nothing is configured", async () => {
    const adapter = createConfigAdapter({ config: createMemoryConfigPort() })
    const resolved = await adapter.resolveEffective()
    expect(resolved.origin).toBe("default")
    expect(resolved.config.activation.enabled).toBe(false)
    expect(resolved.config.activation.mode).toBe("never")
    expect(resolved.config.models.role_pools).toEqual({})
  })

  test("project scope shadows global scope shadows the default", async () => {
    const config = createMemoryConfigPort()
    const adapter = createConfigAdapter({ config })

    const globalSet = await adapter.set("global", projectConfig({ mode: "auto" }), null)
    expect(globalSet.ok).toBe(true)
    const afterGlobal = await adapter.resolveEffective()
    expect(afterGlobal.origin).toBe("global")
    expect(afterGlobal.config.activation.mode).toBe("auto")

    const projectSet = await adapter.set("project", projectConfig({ mode: "always" }), null)
    expect(projectSet.ok).toBe(true)
    const afterProject = await adapter.resolveEffective()
    expect(afterProject.origin).toBe("project")
    expect(afterProject.config.activation.mode).toBe("always")
  })

  test("set() rejects a routing configuration that fails schema validation", async () => {
    const adapter = createConfigAdapter({ config: createMemoryConfigPort() })
    const result = await adapter.set("project", { not: "a routing config" } as unknown as RoutingConfig.Info, null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("validation_failed")
  })

  test("set() reports a CAS conflict on a stale expectedVersion", async () => {
    const adapter = createConfigAdapter({ config: createMemoryConfigPort() })
    await adapter.set("project", projectConfig(), null)
    const stale = await adapter.set("project", projectConfig({ mode: "auto" }), "cas_v0")
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.code).toBe("conflict")
  })

  test("policyVersion is a deterministic content hash that changes when the config content changes", async () => {
    const a = policyVersionOf(projectConfig({ mode: "auto" }))
    const b = policyVersionOf(projectConfig({ mode: "auto" }))
    const c = policyVersionOf(projectConfig({ mode: "always" }))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe("ConfigAdapter.toRoutingConfigSource", () => {
  test("adapts the rich RoutingConfigPort to the thin RoutingConfigSource seam routing-service.ts depends on", async () => {
    const config = createMemoryConfigPort()
    const port = createConfigAdapter({ config })
    await port.set("project", projectConfig({ mode: "always" }), null)

    const source = toRoutingConfigSource(port)
    const resolution = await source.resolve()
    expect(resolution.origin).toBe("project")
    expect(resolution.config.activation.mode).toBe("always")
    expect(resolution.policyVersion).toBe(policyVersionOf(resolution.config))
  })
})
