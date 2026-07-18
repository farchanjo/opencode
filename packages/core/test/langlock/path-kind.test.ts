import { describe, expect, test } from "bun:test"
import { PathKind } from "@opencode-ai/core/langlock/path-kind"

// Feature 004 / T037 (S20) — pure deterministic path-kind classification and
// advisory-eligibility tests (FR8, FR10, FR13, FR20, C5, C12, AC11, AC20). Zero
// I/O: only structural signals about the target are read, never file text.
// Generic code and exempt/untouched targets are NEVER advisory-eligible.

describe("PathKind.classify — prose kinds (FR8, C5)", () => {
  test("classifies markdown as prose_markdown", () => {
    expect(PathKind.classify({ extension: "md" })).toBe("prose_markdown")
    expect(PathKind.classify({ extension: "mdx" })).toBe("prose_markdown")
  })

  test("classifies documentation extensions as docs", () => {
    expect(PathKind.classify({ extension: "rst" })).toBe("docs")
    expect(PathKind.classify({ extension: "txt" })).toBe("docs")
  })

  test("classifies a canonical instruction file as instruction_file", () => {
    expect(PathKind.classify({ extension: "md", isInstructionFile: true })).toBe("instruction_file")
  })

  test("classifies generated commit text as commit_text", () => {
    expect(PathKind.classify({ extension: "", isCommitText: true })).toBe("commit_text")
  })
})

describe("PathKind.classify — non-prose kinds (FR20, C5)", () => {
  test("classifies source-code extensions as generic_code", () => {
    for (const ext of ["ts", "go", "rs", "py", "java", "json", "yaml"]) {
      expect(PathKind.classify({ extension: ext })).toBe("generic_code")
    }
  })

  test("classifies an operator-exempt target as exempt (highest precedence)", () => {
    expect(PathKind.classify({ extension: "md", isExempt: true })).toBe("exempt")
  })

  test("classifies an unrecognized target as unknown", () => {
    expect(PathKind.classify({ extension: "xyz" })).toBe("unknown")
  })
})

describe("PathKind.isAdvisoryEligible — only prose is eligible (FR20, C5, AC11)", () => {
  test("the four prose kinds are eligible", () => {
    for (const kind of ["prose_markdown", "docs", "instruction_file", "commit_text"] as const) {
      expect(PathKind.isAdvisoryEligible(kind)).toBe(true)
    }
  })

  test("generic_code, exempt and unknown are never eligible", () => {
    for (const kind of ["generic_code", "exempt", "unknown"] as const) {
      expect(PathKind.isAdvisoryEligible(kind)).toBe(false)
    }
  })

  test("the exported eligible set is exactly the four prose kinds", () => {
    expect(([...PathKind.ADVISORY_ELIGIBLE_PATH_KINDS] as string[]).sort()).toEqual(
      ["commit_text", "docs", "instruction_file", "prose_markdown"].sort(),
    )
  })
})

describe("PathKind.isAdvisoryTarget — model-authored prose only (FR10, AC20)", () => {
  test("a model-authored prose write is an advisory target", () => {
    expect(PathKind.isAdvisoryTarget({ extension: "md", modelAuthored: true })).toBe(true)
  })

  test("untouched (non-model-authored) content is never a target", () => {
    expect(PathKind.isAdvisoryTarget({ extension: "md", modelAuthored: false })).toBe(false)
  })

  test("model-authored generic code is never a target (AC11)", () => {
    expect(PathKind.isAdvisoryTarget({ extension: "ts", modelAuthored: true })).toBe(false)
  })

  test("an exempt target is never a target even when model-authored", () => {
    expect(PathKind.isAdvisoryTarget({ extension: "md", modelAuthored: true, isExempt: true })).toBe(false)
  })
})
