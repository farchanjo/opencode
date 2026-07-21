/**
 * Feature 051 / T003 — the live-narrowing config resolver.
 *
 * Asserts the agents/skills gates default off and resolve independently of the tools
 * surface (`tool_search`) and of each other, and that `min_prompt_length`/
 * `latency_budget_ms`/`debug_log` fall back to their defaults when `semantic_narrowing`
 * is absent (FR6, FR2, FR8).
 */
import { describe, expect, test } from "bun:test"
import type { NarrowingConfig } from "@opencode-ai/schema/semantic/narrowing-config"
import { ConfigExperimental } from "@opencode-ai/core/config/experimental"

describe("resolveNarrowingConfig", () => {
  test("absent block resolves both gates off with the default knobs", () => {
    const resolved = ConfigExperimental.resolveNarrowingConfig(undefined)
    expect(resolved).toEqual({
      agents: false,
      skills: false,
      minPromptLength: ConfigExperimental.SEMANTIC_NARROWING_DEFAULTS.minPromptLength,
      latencyBudgetMs: ConfigExperimental.SEMANTIC_NARROWING_DEFAULTS.latencyBudgetMs,
      debugLog: false,
    })
  })

  test("min_prompt_length default is 8", () => {
    expect(ConfigExperimental.SEMANTIC_NARROWING_DEFAULTS.minPromptLength).toBe(8)
  })

  test("latency budget reuses the shared tool-search deadline (no second constant)", () => {
    expect(ConfigExperimental.SEMANTIC_NARROWING_DEFAULTS.latencyBudgetMs).toBe(
      ConfigExperimental.TOOL_SEARCH_DEFAULTS.latencyBudgetMs,
    )
  })

  test("agents gate resolves independently of skills", () => {
    const config: NarrowingConfig.SemanticNarrowingConfig = { agents: { enabled: true } }
    const resolved = ConfigExperimental.resolveNarrowingConfig(config)
    expect(resolved.agents).toBe(true)
    expect(resolved.skills).toBe(false)
  })

  test("skills gate resolves independently of agents", () => {
    const config: NarrowingConfig.SemanticNarrowingConfig = { skills: { enabled: true } }
    const resolved = ConfigExperimental.resolveNarrowingConfig(config)
    expect(resolved.skills).toBe(true)
    expect(resolved.agents).toBe(false)
  })

  test("custom min_prompt_length / debug_log / latency_budget_ms override the defaults", () => {
    const config: NarrowingConfig.SemanticNarrowingConfig = {
      min_prompt_length: 24,
      latency_budget_ms: 500,
      debug_log: true,
    }
    const resolved = ConfigExperimental.resolveNarrowingConfig(config)
    expect(resolved.minPromptLength).toBe(24)
    expect(resolved.latencyBudgetMs).toBe(500)
    expect(resolved.debugLog).toBe(true)
  })

  test("narrowingSurfaceEnabled honors each surface gate independently", () => {
    const config: NarrowingConfig.SemanticNarrowingConfig = { agents: { enabled: true }, skills: { enabled: false } }
    expect(ConfigExperimental.narrowingSurfaceEnabled(config, "agents")).toBe(true)
    expect(ConfigExperimental.narrowingSurfaceEnabled(config, "skills")).toBe(false)
    expect(ConfigExperimental.narrowingSurfaceEnabled(undefined, "agents")).toBe(false)
  })

  test("narrowing gates do not perturb the tools surface (tool_search) resolution", () => {
    // The tools surface is gated by the Feature 009 tool_search config, never by
    // semantic_narrowing — resolving one must not touch the other.
    expect(ConfigExperimental.resolveToolSurfaceConfig(undefined, "native").enabled).toBe(false)
  })
})

/**
 * Feature 052 (SR-C) / T002 — the `skill_autoprime` config resolver. Asserts the
 * composed gate is `skill_autoprime.enabled && semantic_narrowing.skills.enabled`
 * (FR1) — either config absent, or either flag false, resolves fully off — and that
 * `score_floor`/`maxChunks`/`maxTokens` fall back to their defaults (FR2, FR4) unless
 * a caller supplies the live-resolved `Budget.Retrieval` slice.
 */
describe("resolveAutoSkillConfig", () => {
  test("both configs absent resolve fully off with every default", () => {
    const resolved = ConfigExperimental.resolveAutoSkillConfig(undefined, undefined)
    expect(resolved).toEqual({
      enabled: false,
      scoreFloor: ConfigExperimental.AUTO_SKILL_DEFAULTS.scoreFloor,
      maxChunks: ConfigExperimental.AUTO_SKILL_DEFAULTS.maxChunks,
      maxTokens: ConfigExperimental.AUTO_SKILL_DEFAULTS.maxTokens,
    })
  })

  test("score_floor default is 0.75", () => {
    expect(ConfigExperimental.AUTO_SKILL_DEFAULTS.scoreFloor).toBe(0.75)
  })

  test("skill_autoprime enabled with the skills surface off still resolves off (composed gate)", () => {
    const resolved = ConfigExperimental.resolveAutoSkillConfig({ skills: { enabled: false } }, { enabled: true })
    expect(resolved.enabled).toBe(false)
  })

  test("skill_autoprime absent, even with the skills surface on, resolves off (composed gate)", () => {
    const resolved = ConfigExperimental.resolveAutoSkillConfig({ skills: { enabled: true } }, undefined)
    expect(resolved.enabled).toBe(false)
  })

  test("skill_autoprime.enabled false, with the skills surface on, resolves off (composed gate)", () => {
    const resolved = ConfigExperimental.resolveAutoSkillConfig({ skills: { enabled: true } }, { enabled: false })
    expect(resolved.enabled).toBe(false)
  })

  test("both skill_autoprime.enabled and the skills surface true resolve the composed gate on", () => {
    const resolved = ConfigExperimental.resolveAutoSkillConfig({ skills: { enabled: true } }, { enabled: true })
    expect(resolved.enabled).toBe(true)
  })

  test("a custom score_floor overrides the strict default", () => {
    const resolved = ConfigExperimental.resolveAutoSkillConfig(
      { skills: { enabled: true } },
      { enabled: true, score_floor: 0.5 },
    )
    expect(resolved.scoreFloor).toBe(0.5)
  })

  test("a supplied Budget.Retrieval slice overrides the local maxChunks/maxTokens mirrors", () => {
    const resolved = ConfigExperimental.resolveAutoSkillConfig(
      { skills: { enabled: true } },
      { enabled: true },
      { max_skill_chunks: 3, max_skill_tokens: 1_200 },
    )
    expect(resolved.maxChunks).toBe(3)
    expect(resolved.maxTokens).toBe(1_200)
  })

  test("absent Budget.Retrieval falls back to the local AUTO_SKILL_DEFAULTS mirrors", () => {
    const resolved = ConfigExperimental.resolveAutoSkillConfig({ skills: { enabled: true } }, { enabled: true })
    expect(resolved.maxChunks).toBe(ConfigExperimental.AUTO_SKILL_DEFAULTS.maxChunks)
    expect(resolved.maxTokens).toBe(ConfigExperimental.AUTO_SKILL_DEFAULTS.maxTokens)
  })
})
