/**
 * Feature 004 / T018 (S7) — write-target path-kind classification and advisory
 * eligibility.
 *
 * Framework-free, deterministic, zero I/O. Classifies a write target as prose
 * (`prose_markdown` / `docs` / `instruction_file` / `commit_text`), `generic_code`,
 * or `exempt`, and exposes the advisory-eligibility rule so that generic code and
 * identifiers/filenames/quoted content are NEVER advisory targets and only
 * model-created or modified portions are classified (FR8, FR10, FR13, FR20, C5, C12,
 * AC11, AC20). Mirrors `enums.cue` `PathKind` semantics; the classifier reads only
 * structural signals about the target, never file text (Security 5).
 */
export * as PathKind from "./path-kind"

import type { PathKind as PathKindEnum } from "@opencode-ai/schema/langlock/enums"

export type { PathKindEnum }

/**
 * The four advisory-eligible prose kinds (FR20, C5, AC11). `generic_code`, `exempt`,
 * and `unknown` are never eligible — generic source code is never advisory-blocked in
 * V1 and an exempt/untouched target is excluded from detection.
 */
export const ADVISORY_ELIGIBLE_PATH_KINDS: ReadonlyArray<PathKindEnum> = Object.freeze([
  "prose_markdown",
  "docs",
  "instruction_file",
  "commit_text",
])

const eligibleSet = new Set<PathKindEnum>(ADVISORY_ELIGIBLE_PATH_KINDS)

/** Markdown/prose extensions classified as `prose_markdown` (FR8, C5). */
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"])

/** Longer-form documentation extensions classified as `docs` (FR8, FR9, C5). */
const DOCS_EXTENSIONS = new Set(["rst", "adoc", "asciidoc", "txt"])

/**
 * Generic source-code extensions classified as `generic_code` — never advisory-eligible
 * (FR20, C5, AC11). The set is illustrative, not exhaustive; any non-prose, non-exempt
 * extension resolves to `generic_code` when the target is code-shaped.
 */
const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "kt",
  "c", "h", "cc", "cpp", "hpp", "cs", "rb", "php", "swift", "scala", "sh",
  "sql", "css", "scss", "html", "json", "yaml", "yml", "toml",
])

/** The structural signals about a write target the classifier reads (content-free). */
export interface ClassifyInput {
  /** Lower-case file extension without the dot, e.g. `md`, `ts` (empty for none). */
  readonly extension: string
  /** True for a canonical instruction file (AGENTS.md, CLAUDE.md, skill docs) (FR8). */
  readonly isInstructionFile?: boolean
  /** True for a generated commit message / commit text target (FR9). */
  readonly isCommitText?: boolean
  /** True when an operator-owned exception already matched the target (FR14, C16). */
  readonly isExempt?: boolean
}

/**
 * Classify a write target into a `PathKind` (FR8, FR9, FR20, C5). Deterministic and
 * total. Precedence: exempt > commit text > instruction file > prose > docs > generic
 * code > unknown. Reads only the structural signals, never the file body.
 */
export function classify(input: ClassifyInput): PathKindEnum {
  if (input.isExempt) return "exempt"
  if (input.isCommitText) return "commit_text"
  if (input.isInstructionFile) return "instruction_file"
  const ext = input.extension.toLowerCase()
  if (MARKDOWN_EXTENSIONS.has(ext)) return "prose_markdown"
  if (DOCS_EXTENSIONS.has(ext)) return "docs"
  if (CODE_EXTENSIONS.has(ext)) return "generic_code"
  return "unknown"
}

/**
 * True when a `PathKind` is advisory-eligible (FR20, C5, AC11). Only the four prose
 * kinds are eligible; `generic_code`, `exempt`, and `unknown` are never eligible.
 */
export function isAdvisoryEligible(kind: PathKindEnum): boolean {
  return eligibleSet.has(kind)
}

/** Whether a write target is a model-authored write, for the advisory-target gate. */
export interface AdvisoryTargetInput extends ClassifyInput {
  /** True only for model-created or model-modified portions (FR10, AC20). */
  readonly modelAuthored: boolean
}

/**
 * True when a write target is an advisory-detection target (FR10, FR13, FR20, C12,
 * AC11, AC20): the portion must be model-created/modified, not exempt, and its
 * structural kind must be advisory-eligible prose. Generic code, exempt paths, and
 * untouched (non-model-authored) content are excluded.
 */
export function isAdvisoryTarget(input: AdvisoryTargetInput): boolean {
  if (!input.modelAuthored) return false
  if (input.isExempt) return false
  return isAdvisoryEligible(classify(input))
}
