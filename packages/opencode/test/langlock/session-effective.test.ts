/**
 * Feature 004 / T026 live wire — session effective resolve + inject survival.
 */
import { describe, expect, test } from "bun:test"
import { LangLockInjection } from "@/langlock/injection-service"
import {
  configPortFromOperatorAuthorities,
  defaultEffectiveConfig,
  resolveSessionLangLockEffective,
} from "@/langlock/session-effective"
import { createLangLockPersistence } from "@/langlock/persistence"
import { Effect } from "effect"

describe("LangLock session-effective (T026 live wire)", () => {
  test("defaults to enabled en-US when operator namespace is absent", async () => {
    const effective = await resolveSessionLangLockEffective({ config: {} })
    expect(effective.language.enabled).toBe(true)
    expect(String(effective.language.tag)).toBe("en-US")
    // Unconfigured resolve uses the persistence default document; origin is default or global.
    expect(["default", "global"]).toContain(String(effective.authority.origin))
  })

  test("reads langlock/global authority payload from operator.authorities", async () => {
    const effective = await resolveSessionLangLockEffective({
      config: {
        operator: {
          authorities: {
            "langlock/global": {
              version: "cas_v1",
              updatedAtMs: 1,
              payload: {
                language: { enabled: true, tag: "pt-BR", enforcement_mode: "advisory" },
                authority: {
                  scope: "global",
                  hard_floor: false,
                  override_authorized: false,
                  manifest_ref: null,
                },
                version: 1,
              },
            },
          },
        },
      },
    })
    expect(String(effective.language.tag)).toBe("pt-BR")
    expect(effective.language.display_name).toContain("Portuguese")
  })

  test("injectIntoSystemArray places a single lock block that reapply survives a strip transform", async () => {
    const effective = await resolveSessionLangLockEffective({
      config: {
        operator: {
          authorities: {
            "langlock/global": {
              version: "cas_v1",
              updatedAtMs: 1,
              payload: {
                language: { enabled: true, tag: "pt-BR", enforcement_mode: "advisory" },
                authority: {
                  scope: "global",
                  hard_floor: false,
                  override_authorized: false,
                  manifest_ref: null,
                },
                version: 1,
              },
            },
          },
        },
      },
    })
    const assembled = LangLockInjection.injectIntoSystemArray(["You are a helpful agent."], effective)
    expect(LangLockInjection.hasSingleLangLockBlock(assembled)).toBe(true)
    expect(assembled.some((e) => e.includes("pt-BR"))).toBe(true)

    // Simulate a plugin that strips the lock (FR25).
    const stripped = LangLockInjection.stripLangLockBlocks(assembled)
    expect(LangLockInjection.hasSingleLangLockBlock(stripped)).toBe(false)
    const reapplied = LangLockInjection.reapplyAfterTransform(stripped, effective)
    expect(LangLockInjection.hasSingleLangLockBlock(reapplied)).toBe(true)
    expect(reapplied.some((e) => e.includes("Portuguese"))).toBe(true)
  })

  test("configPortFromOperatorAuthorities is read-only", async () => {
    const port = configPortFromOperatorAuthorities({})
    const cas = await port.compareAndSet({
      authority: "langlock/global",
      expectedVersion: null,
      payload: {},
      nowMs: 0,
    })
    expect(cas.ok).toBe(false)
    if (!cas.ok) expect(cas.code).toBe("unavailable")
  })

  test("defaultEffectiveConfig matches persistence default language", () => {
    const d = defaultEffectiveConfig()
    expect(String(d.language.tag)).toBe("en-US")
    expect(d.language.enabled).toBe(true)
  })

  test("persistence resolveEffective over the same port agrees with session resolve", async () => {
    const payload = {
      language: { enabled: true, tag: "es-ES", enforcement_mode: "advisory" as const },
      authority: {
        scope: "global" as const,
        hard_floor: false,
        override_authorized: false,
        manifest_ref: null,
      },
      version: 1,
    }
    const authorities = {
      "langlock/global": { version: "cas_v1", updatedAtMs: 1, payload },
    }
    const session = await resolveSessionLangLockEffective({
      config: { operator: { authorities } },
    })
    const persistence = createLangLockPersistence({
      config: configPortFromOperatorAuthorities(authorities),
    })
    const viaPersistence = await Effect.runPromise(persistence.resolveEffective(null))
    expect(String(session.language.tag)).toBe(String(viaPersistence.effective.language.tag))
    expect(String(session.language.tag)).toBe("es-ES")
  })
})
