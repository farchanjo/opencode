/**
 * Feature 004 / T039 (S20) — Config.Service Lang Lock persistence integration
 * (FR5, FR7, C2, C15, AC5, AC16). Durable `LangLockConfig` persistence through
 * the REUSED Feature 007 `ConfigPort` (the in-memory double of the Config.Service
 * authority): CAS create/update, version-conflict on a stale write, the enabled
 * en-US default for an unconfigured project, an authorized project override, and
 * the non-relaxable hard-policy floor. Mirrors `test/jobs/persistence.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { createMemoryConfigPort } from "@/operator/adapters"
import { createLangLockPersistence, defaultConfig } from "@/langlock/persistence"
import { Config } from "@opencode-ai/schema/langlock/config"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)
const exit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect)

const makeConfig = (input: {
  enabled?: boolean
  tag?: string
  scope?: string
  hardFloor?: boolean
  overrideAuthorized?: boolean
  version?: number
}): Config.LangLockConfig =>
  Schema.decodeUnknownSync(Config.LangLockConfig)({
    language: { enabled: input.enabled ?? true, tag: input.tag ?? "en-US", enforcement_mode: "advisory" },
    authority: {
      scope: input.scope ?? "project",
      hard_floor: input.hardFloor ?? false,
      override_authorized: input.overrideAuthorized ?? false,
      manifest_ref: null,
    },
    version: input.version ?? 1,
  })

function build() {
  const config = createMemoryConfigPort()
  const persistence = createLangLockPersistence({ config, clock: () => 1_721_260_800_000 })
  return { config, persistence }
}

describe("T039 persistence — CAS create/update (FR5, AC5)", () => {
  test("save then read round-trips the durable config with a CAS token", async () => {
    const { persistence } = build()
    const saved = await run(
      persistence.saveConfig({ scope: "global", scopeId: "", config: makeConfig({}), expectedVersion: null }),
    )
    expect(saved.casVersion).toBeDefined()
    const loaded = await run(persistence.readConfig("global", ""))
    expect(String(loaded?.config.language.tag)).toBe("en-US")
    expect(loaded?.casVersion).toBe(saved.casVersion)
  })

  test("a stale create (expectedVersion null on an existing authority) is a version conflict", async () => {
    const { persistence } = build()
    await run(persistence.saveConfig({ scope: "global", scopeId: "", config: makeConfig({}), expectedVersion: null }))
    const conflict = await exit(
      persistence.saveConfig({ scope: "global", scopeId: "", config: makeConfig({}), expectedVersion: null }),
    )
    expect(conflict._tag).toBe("Failure")
    if (conflict._tag === "Failure") expect(JSON.stringify(conflict.cause.toJSON())).toContain("version_conflict")
  })

  test("an update under the correct CAS token succeeds and advances the token", async () => {
    const { persistence } = build()
    const first = await run(
      persistence.saveConfig({ scope: "global", scopeId: "", config: makeConfig({}), expectedVersion: null }),
    )
    const updated = await run(
      persistence.saveConfig({
        scope: "global",
        scopeId: "",
        config: makeConfig({ tag: "pt-BR", version: 2 }),
        expectedVersion: first.casVersion,
      }),
    )
    expect(updated.casVersion).not.toBe(first.casVersion)
    expect(String((await run(persistence.readConfig("global", "")))?.config.language.tag)).toBe("pt-BR")
  })
})

describe("T039 persistence — enabled en-US default resolution (FR1, C15, AC16)", () => {
  test("an unconfigured project resolves to the enabled en-US default without a stored write", async () => {
    const { persistence } = build()
    const resolution = await run(persistence.resolveEffective(null))
    expect(resolution.effective.language.enabled).toBe(true)
    expect(String(resolution.effective.language.tag)).toBe("en-US")
    expect(resolution.outcome.kind).toBe("retained")
  })

  test("the exported defaultConfig is the enabled en-US project document", () => {
    expect(String(defaultConfig.language.tag)).toBe("en-US")
    expect(defaultConfig.language.enabled).toBe(true)
    expect(defaultConfig.authority.scope).toBe("project")
  })
})

describe("T039 persistence — override resolution and the hard floor (FR5, AC5, AC6)", () => {
  test("an authorized project override is applied over the global base (AC6)", async () => {
    const { persistence } = build()
    await run(persistence.saveConfig({ scope: "global", scopeId: "", config: makeConfig({ tag: "en-US" }), expectedVersion: null }))
    await run(
      persistence.saveConfig({
        scope: "project",
        scopeId: "proj1",
        config: makeConfig({ tag: "pt-BR", overrideAuthorized: true, version: 2 }),
        expectedVersion: null,
      }),
    )
    const resolution = await run(persistence.resolveEffective("proj1"))
    expect(resolution.outcome.kind).toBe("applied")
    expect(String(resolution.effective.language.tag)).toBe("pt-BR")
    expect(resolution.effective.authority.origin).toBe("project")
  })

  test("an authorized override that would relax the hard floor is retained, never applied (AC5)", async () => {
    const { persistence } = build()
    await run(
      persistence.saveConfig({
        scope: "global",
        scopeId: "",
        config: makeConfig({ tag: "en-US", hardFloor: true }),
        expectedVersion: null,
      }),
    )
    await run(
      persistence.saveConfig({
        scope: "project",
        scopeId: "proj1",
        config: makeConfig({ tag: "pt-BR", overrideAuthorized: true, version: 2 }),
        expectedVersion: null,
      }),
    )
    const resolution = await run(persistence.resolveEffective("proj1"))
    expect(resolution.outcome.kind).toBe("retained")
    expect(String(resolution.effective.language.tag)).toBe("en-US")
  })
})

describe("T039 persistence — content-free durable document (Security 5)", () => {
  test("the raw persisted document carries only bounded enums/flags/tags, never file text", async () => {
    const { config, persistence } = build()
    await run(persistence.saveConfig({ scope: "global", scopeId: "", config: makeConfig({}), expectedVersion: null }))
    const entry = await config.get("langlock/global")
    const doc = JSON.stringify(entry?.payload)
    expect(doc).toContain("en-US")
    expect(doc).not.toContain("prompt")
    expect(doc).not.toContain("BEGIN PRIVATE KEY")
  })
})
