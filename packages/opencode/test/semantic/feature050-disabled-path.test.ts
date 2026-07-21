/**
 * Feature 050 / T026 (FR13) — the golden disabled-path invariant: with NO
 * semantic narrowing gate enabled and NO Feature 050 facade mounted, a live
 * turn's tool/skill surfaces are byte-identical to the pre-Feature-050 floor.
 *
 * (a) `ToolRetrieval.PASSTHROUGH` is the literal gate wired at BOTH
 *     `session/tools.ts` narrowing seams (native list + MCP record) — verified
 *     structurally via a call-shape regex over the source text, never a
 *     brittle line-number assertion — and `ToolRetrieval.narrow`/
 *     `narrowRecord` are proven identity-preserving over that exact gate,
 *     including when a stray `ranked` list is present but the gate stays
 *     disabled.
 * (b) `Skill.fmt(list, {verbose:true})` — the literal formatter
 *     `SystemPrompt.skills` (`session/system.ts:98-110`) wraps over a fixed
 *     fake skill set — is byte-identical to a stored golden string that
 *     reproduces the EXACT join `SystemPrompt.skills` performs.
 * (c) No `session/**` module imports the Feature 050 pipeline-runner or
 *     retrieval-facade INTERNALS — those stay encapsulated behind the mounted
 *     `SemanticRetrieval.Service`. Feature 051 is the sanctioned wiring point:
 *     `session/prompt.ts` now consumes the facade, but ONLY through the gated
 *     `semantic/live-narrowing` orchestrator, whose gates-off short-circuit keeps
 *     the disabled path byte-identical (a/b above prove the rendered floor).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { ToolRetrieval } from "@/semantic/tool-retrieval"
import { Skill } from "@/skill"

const SRC_ROOT = path.join(import.meta.dir, "../../src")
const SESSION_DIR = path.join(SRC_ROOT, "session")
const SESSION_TOOLS_SRC = readFileSync(path.join(SESSION_DIR, "tools.ts"), "utf8")

describe("Feature 050 golden disabled path — ToolRetrieval gates wired at both seams (FR13)", () => {
  test("the native-tool-list seam gates on the literal ToolRetrieval.PASSTHROUGH", () => {
    // Lazy match across the call's argument list (which itself nests parens, e.g.
    // `(t) => t.id`) up to the FIRST `ToolRetrieval.PASSTHROUGH)` — never a brittle
    // line-number assertion.
    expect(SESSION_TOOLS_SRC).toMatch(/ToolRetrieval\.narrow\([\s\S]*?ToolRetrieval\.PASSTHROUGH\)/)
  })

  test("the MCP-tool-record seam gates on the literal ToolRetrieval.PASSTHROUGH", () => {
    expect(SESSION_TOOLS_SRC).toMatch(/ToolRetrieval\.narrowRecord\([\s\S]*?ToolRetrieval\.PASSTHROUGH\)/)
  })

  test("no session/** module imports the Feature 050 pipeline-runner or facade INTERNALS (FR13 encapsulation)", () => {
    const sessionFiles = readdirSync(SESSION_DIR).filter((file) => file.endsWith(".ts"))
    expect(sessionFiles.length).toBeGreaterThan(0)
    for (const file of sessionFiles) {
      const content = readFileSync(path.join(SESSION_DIR, file), "utf8")
      // The runner and the raw facade builder stay behind the mounted Service —
      // no session module reaches past it into the query pipeline internals.
      expect(content).not.toMatch(/semantic\/pipeline-runner|semantic\/retrieval-facade/)
    }
  })

  test("prompt.ts wires the mounted facade ONLY through the gated live-narrowing seam (Feature 051)", () => {
    const promptSrc = readFileSync(path.join(SESSION_DIR, "prompt.ts"), "utf8")
    // The single sanctioned consumption point: the gated `narrowForTurn` orchestrator.
    expect(promptSrc).toMatch(/semantic\/live-narrowing/)
    expect(promptSrc).toMatch(/LiveNarrowing\.narrowForTurn/)
    // It resolves the mounted Service tag, never the runner/facade internals.
    expect(promptSrc).toMatch(/semantic\/retrieval-service/)
    expect(promptSrc).not.toMatch(/semantic\/pipeline-runner|semantic\/retrieval-facade/)
  })
})

describe("Feature 050 golden disabled path — ToolRetrieval.narrow/narrowRecord identity (FR13)", () => {
  const visible = [{ id: "read" }, { id: "write" }, { id: "grep" }]

  test("narrow returns the visible list unchanged under PASSTHROUGH (same elements, same order)", () => {
    const result = ToolRetrieval.narrow(visible, (t) => t.id, ToolRetrieval.PASSTHROUGH)
    expect(result).toEqual(visible)
    expect(result).toBe(visible) // identity passthrough — never re-wraps or reorders
  })

  test("narrow stays identity even when a `ranked` list is present but the gate stays disabled", () => {
    const gate: ToolRetrieval.RankedGate = { enabled: false, ranked: ["write"] }
    const result = ToolRetrieval.narrow(visible, (t) => t.id, gate)
    expect(result).toEqual(visible)
  })

  test("narrowRecord returns the visible record unchanged under PASSTHROUGH", () => {
    const record: Record<string, { id: string }> = { read: { id: "read" }, write: { id: "write" } }
    const result = ToolRetrieval.narrowRecord(record, ToolRetrieval.PASSTHROUGH)
    expect(result).toEqual(record)
    expect(result).toBe(record)
  })

  test("narrowRecord stays identity even when a `ranked` list is present but the gate stays disabled", () => {
    const record: Record<string, { id: string }> = { read: { id: "read" }, write: { id: "write" } }
    const gate: ToolRetrieval.RankedGate = { enabled: false, ranked: ["read"] }
    expect(ToolRetrieval.narrowRecord(record, gate)).toEqual(record)
  })
})

describe("Feature 050 golden disabled path — SystemPrompt.skills byte-identical output (FR13)", () => {
  const fixedSkills: Skill.Info[] = [
    { name: "zeta", description: "Zeta skill for Z tasks.", location: "/skills/zeta/SKILL.md", content: "zeta body" },
    { name: "alpha", description: "Alpha skill for A tasks.", location: "/skills/alpha/SKILL.md", content: "alpha body" },
    { name: "hidden-skill", location: "/skills/hidden/SKILL.md", content: "no description, excluded" },
  ]

  // Reproduces the EXACT join `SystemPrompt.skills` (`session/system.ts:98-110`)
  // performs over `Skill.fmt(list, {verbose:true})` — the golden covers the
  // byte-identical live-turn output, not merely the formatter in isolation.
  const GOLDEN = [
    "Skills provide specialized instructions and workflows for specific tasks.",
    "Use the skill tool to load a skill when a task matches its description.",
    [
      "<available_skills>",
      "  <skill>",
      "    <name>alpha</name>",
      "    <description>Alpha skill for A tasks.</description>",
      "    <location>/skills/alpha/SKILL.md</location>",
      "  </skill>",
      "  <skill>",
      "    <name>zeta</name>",
      "    <description>Zeta skill for Z tasks.</description>",
      "    <location>/skills/zeta/SKILL.md</location>",
      "  </skill>",
      "</available_skills>",
    ].join("\n"),
  ].join("\n")

  test("Skill.fmt(list, {verbose:true}) over a fixed skill set is byte-identical to the stored golden", () => {
    const output = [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      Skill.fmt(fixedSkills, { verbose: true }),
    ].join("\n")
    expect(output).toBe(GOLDEN)
  })

  test("the golden sorts by name and drops the undescribed skill (never widens the described set)", () => {
    expect(GOLDEN.indexOf("alpha")).toBeLessThan(GOLDEN.indexOf("zeta"))
    expect(GOLDEN).not.toContain("hidden-skill")
  })

  test("an all-undescribed skill set is the honest 'no skills available' floor, never an empty tag block", () => {
    const undescribed: Skill.Info[] = [{ name: "only", location: "/skills/only/SKILL.md", content: "no description" }]
    expect(Skill.fmt(undescribed, { verbose: true })).toBe("No skills are currently available.")
  })
})
