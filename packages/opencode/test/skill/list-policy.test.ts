import { expect, test } from "bun:test"
import { applySkillListCap, formatSkillListBlock, formatSkillListStatus } from "../../src/skill/list-policy"
import { ConfigExperimental } from "@opencode-ai/core/config/experimental"

const skills = Array.from({ length: 50 }, (_, i) => ({
  name: `s${String(i).padStart(2, "0")}`,
  description: `Description for skill ${i} `.repeat(5),
  location: `/tmp/s${i}/SKILL.md`,
}))

test("defaults resolve to max 24 compact hard_cap", () => {
  const p = ConfigExperimental.resolveSkillListConfig(undefined)
  expect(p.maxListed).toBe(24)
  expect(p.format).toBe("compact")
  expect(p.hardCap).toBe(true)
})

test("semantic ranked order is preserved and capped", () => {
  const policy = ConfigExperimental.resolveSkillListConfig({ max_listed: 3, hard_cap: true })
  const ranked = ["s10", "s05", "s20", "s01"]
  const visible = skills.filter((s) => ranked.includes(s.name))
  const r = applySkillListCap(visible, policy, { ranked })
  expect(r.mode).toBe("ranked")
  expect(r.list.map((s) => s.name)).toEqual(["s10", "s05", "s20"])
  expect(r.capped).toBe(true)
})

test("format does not re-sort ranked order", () => {
  const list = [
    { name: "z-last", description: "z", location: "/z" },
    { name: "a-first", description: "a", location: "/a" },
  ]
  const block = formatSkillListBlock(list, "names")
  expect(block.indexOf("z-last")).toBeLessThan(block.indexOf("a-first"))
})

test("lexical orders by prompt tokens when no ranking", () => {
  const policy = ConfigExperimental.resolveSkillListConfig({ max_listed: 5 })
  const visible = [
    { name: "alpha", description: "unrelated", location: "/a" },
    { name: "rust", description: "Rust edition 2024 playbook", location: "/r" },
    { name: "beta", description: "other", location: "/b" },
  ]
  const r = applySkillListCap(visible, policy, { prompt: "help me with rust async" })
  expect(r.mode).toBe("lexical")
  expect(r.list[0]!.name).toBe("rust")
  expect(r.listed).toBeLessThanOrEqual(5)
})

test("status line reports mode", () => {
  const policy = ConfigExperimental.resolveSkillListConfig({ max_listed: 10 })
  const r = applySkillListCap(skills, policy, { ranked: skills.slice(0, 3).map((s) => s.name) })
  expect(formatSkillListStatus(r)).toContain("mode=ranked")
})

test("names format has no descriptions", () => {
  const block = formatSkillListBlock(skills.slice(0, 5), "names")
  expect(block).toContain("<name>s00</name>")
  expect(block).not.toContain("<description>")
})

test("compact truncates long descriptions", () => {
  const long = [{ name: "x", description: "y".repeat(200), location: "/x" }]
  const block = formatSkillListBlock(long, "compact")
  expect(block).toContain("…")
  expect(block).not.toContain("y".repeat(150))
})
