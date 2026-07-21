import { describe, expect, test } from "bun:test"
import { SkillDocBuilder } from "@opencode-ai/core/semantic/skill-doc"

// Feature 050 / T003 — the pure `Skill.Info -> SkillDoc` builder: field mapping
// correctness, empty-`TagSet` defaults, the `permission_ref` hash derivation
// (skill name alone), and that `content_hash` never incorporates `content`
// (only `description`/`slash` feed it — the full body feeds `skill-chunk.ts`
// exclusively, `data-model.md` "SkillDoc field mapping").

const baseSkill = (overrides: Partial<SkillDocBuilder.SkillInfoLike> = {}): SkillDocBuilder.SkillInfoLike => ({
  name: "deploy-helper",
  description: "helps deploy the service",
  slash: true,
  content: "# Deploy Helper\n\nStep one. Step two. Step three.",
  ...overrides,
})

describe("SkillDocBuilder.build — field mapping (FR7)", () => {
  test("maps direct fields and honest empty TagSet/[] defaults", () => {
    const doc = SkillDocBuilder.build(baseSkill())
    expect(doc.id as string).toBe("deploy-helper")
    expect(doc.descriptor.name).toBe("deploy-helper")
    expect(doc.descriptor.description).toBe("helps deploy the service")
    expect(doc.taxonomy.triggers).toEqual([])
    expect(doc.taxonomy.domains).toEqual([])
    expect(doc.taxonomy.capabilities).toEqual([])
    expect(doc.compat.roles).toEqual([])
    expect(doc.compat.agents).toEqual([])
    expect(doc.cost.languages).toEqual([])
    expect(doc.identity.version).toBe(1)
    expect(doc.identity.source).toBe("skill")
  })

  test("token_estimate is derived from the whole content body", () => {
    const short = SkillDocBuilder.build(baseSkill({ content: "abcd" }))
    const long = SkillDocBuilder.build(baseSkill({ content: "abcd".repeat(100) }))
    expect(short.cost.token_estimate).toBe(1)
    expect(long.cost.token_estimate).toBeGreaterThan(short.cost.token_estimate)
  })

  test("description is scrubbed of path/secret-shaped substrings (ranking signal only)", () => {
    const doc = SkillDocBuilder.build(baseSkill({ description: "see /Users/me/secret/key.pem" }))
    expect(doc.descriptor.description).toContain("[path]")
  })
})

describe("SkillDocBuilder.build — permission_ref hash derivation (skill name alone)", () => {
  test("permission_ref is stable and derived from the name only, independent of content_hash", () => {
    const a = SkillDocBuilder.build(baseSkill())
    const b = SkillDocBuilder.build(baseSkill({ description: "an entirely different description" }))
    expect(a.compat.permission_ref).toBe(b.compat.permission_ref)
    expect(a.compat.permission_ref).not.toBe(a.identity.content_hash)
  })

  test("a different skill name yields a different permission_ref", () => {
    const a = SkillDocBuilder.build(baseSkill({ name: "deploy-helper" }))
    const b = SkillDocBuilder.build(baseSkill({ name: "rollback-helper" }))
    expect(a.compat.permission_ref).not.toBe(b.compat.permission_ref)
  })
})

describe("SkillDocBuilder.build — content_hash never incorporates content", () => {
  test("identical description/slash but different content yields the SAME content_hash", () => {
    const a = SkillDocBuilder.build(baseSkill({ content: "version one body" }))
    const b = SkillDocBuilder.build(baseSkill({ content: "an entirely different, much longer version two body" }))
    expect(a.identity.content_hash).toBe(b.identity.content_hash)
  })

  test("a description edit changes content_hash", () => {
    const original = SkillDocBuilder.build(baseSkill())
    const edited = SkillDocBuilder.build(baseSkill({ description: "a different description" }))
    expect(edited.identity.content_hash).not.toBe(original.identity.content_hash)
  })

  test("a slash-flag change alone changes content_hash", () => {
    const withSlash = SkillDocBuilder.build(baseSkill({ slash: true }))
    const withoutSlash = SkillDocBuilder.build(baseSkill({ slash: false }))
    expect(withSlash.identity.content_hash).not.toBe(withoutSlash.identity.content_hash)
  })
})
