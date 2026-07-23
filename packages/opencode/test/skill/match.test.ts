import { expect, test } from "bun:test"
import {
  MAX_MATCHED_SKILLS,
  RESERVED_TRIGGER_SLOTS,
  matchSkills,
  triggerHits,
  type SkillMeta,
} from "../../src/skill/match"

const meta = (partial: Partial<SkillMeta> & Pick<SkillMeta, "name">): SkillMeta => ({
  paths: [],
  triggers: [],
  variants: [],
  userInvocable: true,
  ...partial,
})

test("path glob match", () => {
  const catalog = [meta({ name: "rust", paths: ["**/*.rs", "Cargo.toml"] })]
  const out = matchSkills(["src/main.rs", "README.md"], "hello", catalog)
  expect(out).toHaveLength(1)
  expect(out[0]!.name).toBe("rust")
  expect(out[0]!.reason).toBe("path")
  expect(out[0]!.bodySource).toBe("rust")
})

test("trigger whole-word match", () => {
  const catalog = [meta({ name: "debug", triggers: ["panic"] })]
  expect(matchSkills([], "we hit a panic in prod", catalog)[0]!.name).toBe("debug")
  expect(matchSkills([], "panicked? no — panic", catalog)).toHaveLength(1)
  expect(matchSkills([], "no match here", catalog)).toHaveLength(0)
})

test("triggerHits rejects substring inside larger token", () => {
  expect(triggerHits("myrustcode", ["rust"])).toBe(false)
  expect(triggerHits("love rust now", ["rust"])).toBe(true)
})

test("both path and trigger counts once as path", () => {
  const catalog = [meta({ name: "rust", paths: ["Cargo.toml"], triggers: ["rust"] })]
  const out = matchSkills(["Cargo.toml"], "rust async", catalog)
  expect(out).toHaveLength(1)
  expect(out[0]!.reason).toBe("path")
})

test("userInvocable false excluded from top-level", () => {
  const catalog = [
    meta({ name: "docker-container", paths: ["Dockerfile"], userInvocable: false }),
    meta({ name: "container", paths: ["Dockerfile"], variants: ["docker-container"] }),
  ]
  const out = matchSkills(["Dockerfile"], undefined, catalog)
  expect(out.map((r) => r.name)).toEqual(["container"])
  expect(out[0]!.bodySource).toBe("docker-container")
  expect(out[0]!.hub).toBe("container")
})

test("hub variant with highest score wins", () => {
  const catalog = [
    meta({
      name: "container",
      paths: ["Dockerfile", "**/compose.yaml"],
      variants: ["docker-container", "podman-container"],
    }),
    meta({
      name: "docker-container",
      paths: ["Dockerfile"],
      userInvocable: false,
    }),
    meta({
      name: "podman-container",
      paths: ["**/containers.conf"],
      userInvocable: false,
    }),
  ]
  const out = matchSkills(["Dockerfile"], undefined, catalog)
  expect(out[0]!.bodySource).toBe("docker-container")
})

test("cap and reserved trigger slots", () => {
  const pathSkills = Array.from({ length: 8 }, (_, i) =>
    meta({ name: `p${i}`, paths: [`file${i}.txt`] }),
  )
  const triggerSkill = meta({ name: "debug", triggers: ["panic"] })
  const files = pathSkills.map((_, i) => `file${i}.txt`)
  const out = matchSkills(files, "please panic now", [...pathSkills, triggerSkill])
  expect(out.length).toBe(MAX_MATCHED_SKILLS)
  expect(out.some((r) => r.name === "debug")).toBe(true)
  const pathCount = out.filter((r) => r.reason === "path").length
  expect(pathCount).toBe(MAX_MATCHED_SKILLS - Math.min(1, RESERVED_TRIGGER_SLOTS))
})

test("empty catalog", () => {
  expect(matchSkills(["a.rs"], "x", [])).toEqual([])
})

test("declaration order preserved within class", () => {
  const catalog = [
    meta({ name: "a", paths: ["**/*.rs"] }),
    meta({ name: "b", paths: ["**/*.rs"] }),
  ]
  const out = matchSkills(["x.rs"], undefined, catalog)
  expect(out.map((r) => r.name)).toEqual(["a", "b"])
})
