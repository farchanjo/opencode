/**
 * Feature 004 / T039 (S20) — immutable system-prompt injection with
 * post-transform reapplication (FR11, FR17, FR25, C4, C7, AC7, AC15, AC17, AC19).
 * The effective-language block survives a mutating/reordering/duplicating
 * `experimental.chat.system.transform`: exactly one canonical copy is guaranteed,
 * the conversational axis (every non-lock entry) is untouched, and a disabled lock
 * strips the block entirely.
 */
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { LangLockInjection } from "@/langlock/injection-service"
import { Effective } from "@opencode-ai/schema/langlock/effective"

const effective = (enabled: boolean, tag = "en-US", display = "English (United States)"): Effective.EffectiveConfig =>
  Schema.decodeUnknownSync(Effective.EffectiveConfig)({
    language: { enabled, tag, display_name: display, enforcement_mode: "advisory" },
    authority: { scope: "project", origin: "global", policy_version: 1, override_authorized: false },
  })

const CONVERSATIONAL = ["You are a helpful assistant.", "Follow the user's instructions."]

describe("T039 injection — assembly injects exactly one canonical block (FR17, AC19)", () => {
  test("injects a single block and leaves the conversational entries untouched", () => {
    const injected = LangLockInjection.injectIntoSystemArray(CONVERSATIONAL, effective(true))
    expect(LangLockInjection.hasSingleLangLockBlock(injected)).toBe(true)
    expect(injected.slice(0, 2)).toEqual(CONVERSATIONAL)
  })

  test("the block names the effective language but carries no file text or path (Security 5)", () => {
    const injected = LangLockInjection.injectIntoSystemArray(CONVERSATIONAL, effective(true, "pt-BR", "Portuguese (Brazil)"))
    const block = injected.find((e) => e.includes(LangLockInjection.LANG_LOCK_MARKER)) ?? ""
    expect(block).toContain("pt-BR")
    expect(block).toContain("Portuguese (Brazil)")
    expect(block).not.toContain("/Users/")
  })
})

describe("T039 injection — survives a mutating transform (FR25, AC7)", () => {
  test("a transform that strips, reorders, and duplicates cannot defeat the lock", () => {
    const injected = LangLockInjection.injectIntoSystemArray(CONVERSATIONAL, effective(true))
    // Simulate a hostile transform: reverse order and duplicate the lock block.
    const lock = injected.find((e) => e.includes(LangLockInjection.LANG_LOCK_MARKER)) ?? ""
    const mutated = [...injected].reverse().concat(lock)
    const reapplied = LangLockInjection.reapplyAfterTransform(mutated, effective(true))
    expect(LangLockInjection.hasSingleLangLockBlock(reapplied)).toBe(true)
    // Every conversational entry is still present after reapplication.
    for (const entry of CONVERSATIONAL) expect(reapplied).toContain(entry)
  })

  test("a transform that fully strips the block has it restored on reapply", () => {
    const stripped = LangLockInjection.stripLangLockBlocks(
      LangLockInjection.injectIntoSystemArray(CONVERSATIONAL, effective(true)),
    )
    expect(LangLockInjection.hasSingleLangLockBlock(stripped)).toBe(false)
    const reapplied = LangLockInjection.reapplyAfterTransform(stripped, effective(true))
    expect(LangLockInjection.hasSingleLangLockBlock(reapplied)).toBe(true)
  })
})

describe("T039 injection — disabled lock strips the block (FR11)", () => {
  test("a disabled effective config strips any prior block and adds none", () => {
    const injected = LangLockInjection.injectIntoSystemArray(CONVERSATIONAL, effective(true))
    const disabled = LangLockInjection.injectIntoSystemArray(injected, effective(false))
    expect(LangLockInjection.hasSingleLangLockBlock(disabled)).toBe(false)
    expect(disabled).toEqual(CONVERSATIONAL)
  })
})
