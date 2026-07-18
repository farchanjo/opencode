import { describe, expect, test } from "bun:test"
import {
  createOperatorCommandRegistry,
  createSeededOperatorCommandRegistry,
  generateAliases,
  seedReservedCatalog,
} from "@/operator/application"
import { RESERVED_CATALOG, listReservedIds } from "@opencode-ai/core/operator"

describe("OperatorCommandRegistry (T008)", () => {
  test("seeded registry loads all reserved ids deterministically", () => {
    const a = createSeededOperatorCommandRegistry()
    const b = createSeededOperatorCommandRegistry()
    expect(a.size()).toBe(listReservedIds().length)
    expect(a.list().map((d) => d.id)).toEqual(b.list().map((d) => d.id))
    expect(a.catalogVersion()).toBe(RESERVED_CATALOG.version)
  })

  test("same command id yields stable aliases", () => {
    const aliases = generateAliases("langlock.status")
    expect(aliases.slash).toBe("/op.langlock.status")
    expect(aliases.cli).toEqual(["op", "langlock", "status"])
    expect(aliases.palette).toBe("langlock.status")
    const again = generateAliases("langlock.status")
    expect(again).toEqual(aliases)
  })

  test("dual register of same id fails", () => {
    const registry = createOperatorCommandRegistry()
    const first = registry.register({
      id: "telemetry.status",
      mutates: false,
      scopesAllowed: ["project"],
      authority: "native",
    })
    expect(first.ok).toBe(true)
    const second = registry.register({
      id: "telemetry.status",
      mutates: false,
      scopesAllowed: ["project"],
      authority: "native",
    })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.code).toBe("conflict")
  })

  test("plugin/mcp/custom cannot register reserved ids", () => {
    const registry = createSeededOperatorCommandRegistry()
    for (const authority of ["plugin", "mcp", "custom"] as const) {
      const r = registry.register({
        id: "langlock.status",
        mutates: false,
        scopesAllowed: ["project"],
        authority,
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe("reserved_name")
    }
  })

  test("plugin may register non-reserved id", () => {
    const registry = createSeededOperatorCommandRegistry()
    const r = registry.register({
      id: "myplugin.hello",
      mutates: false,
      scopesAllowed: ["project"],
      authority: "plugin",
    })
    expect(r.ok).toBe(true)
    expect(registry.lookup("myplugin.hello")?.authority).toBe("plugin")
  })

  test("lookup by alias", () => {
    const registry = createSeededOperatorCommandRegistry()
    const bySlash = registry.lookupByAlias("/op.routing.test")
    expect(bySlash ? String(bySlash.id) : undefined).toBe("routing.test")
    const byPalette = registry.lookupByAlias("routing.test")
    expect(byPalette ? String(byPalette.id) : undefined).toBe("routing.test")
  })

  test("invalid id rejected at register", () => {
    const registry = createOperatorCommandRegistry()
    const r = registry.register({
      id: "not a valid",
      mutates: false,
      scopesAllowed: ["project"],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("invalid_argument")
  })

  test("seedReservedCatalog is idempotent only once (second seed throws)", () => {
    const registry = createOperatorCommandRegistry()
    seedReservedCatalog(registry)
    expect(() => seedReservedCatalog(registry)).toThrow()
  })

  test("no global singleton leak across instances", () => {
    const a = createOperatorCommandRegistry()
    a.register({ id: "custom.only-a", mutates: false, scopesAllowed: ["global"] })
    const b = createOperatorCommandRegistry()
    expect(b.lookup("custom.only-a")).toBeUndefined()
    expect(a.lookup("custom.only-a")).toBeDefined()
  })
})
