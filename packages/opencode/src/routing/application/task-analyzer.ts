/**
 * Feature 001 — Deterministic local TaskAnalyzer (composition-root heuristic).
 *
 * Implements the `TaskAnalyzer` outbound port (ports.ts): the model-free step
 * that keeps the "zero LLM call" invariant honest. The raw task description
 * NEVER reaches a model — a pure, deterministic heuristic over the description
 * text (and the operator-declared scope) produces the structured
 * `Decision.DecisionInputs`, the hard-gate `DimensionRequirements`, and the
 * `RankingCriteria` the routing pipeline (classifier -> evaluator) consumes.
 *
 * Every signal below is a documented, replay-stable function of the input
 * string only: same text -> same analysis, no clock, no randomness, no I/O.
 * The lexicons are deliberate, conservative defaults exported as data so a
 * future config-driven override (routing policy) can replace them without
 * touching the algorithm — the same "open parameter" discipline the classifier
 * and evaluator already follow.
 */
export * as RoutingTaskAnalyzer from "./task-analyzer"

import type { Decision } from "@opencode-ai/schema/routing/decision"
import type { Enums } from "@opencode-ai/schema/routing/enums"
import type { DimensionRequirements, RankingCriteria } from "../domain/routing-evaluator"
import type { TaskAnalyzer, TaskAnalysis, TaskAnalyzerInput } from "./ports"

// =============================================================================
// Lexicons (open-parameter defaults)
// =============================================================================

/**
 * Domain families. A family contributes at most 1 to `domain_count` when ANY
 * of its keywords appears — so "add an API endpoint and a DB migration" counts
 * two domains (backend + data), not two keywords of one domain.
 */
const DOMAIN_FAMILIES: Readonly<Record<string, ReadonlyArray<string>>> = {
  frontend: ["ui", "frontend", "css", "html", "component", "react", "tsx", "layout", "render"],
  backend: ["api", "endpoint", "server", "handler", "route", "grpc", "rpc", "service"],
  data: ["database", "db", "sql", "schema", "migration", "migrate", "query", "index", "table"],
  infra: ["infra", "deploy", "docker", "kubernetes", "k8s", "pipeline", "ci", "terraform"],
  security: ["auth", "security", "mtls", "tls", "cert", "certificate", "token", "secret", "oauth", "jwt", "encrypt"],
  test: ["test", "spec", "assert", "coverage", "fixture"],
  docs: ["doc", "docs", "readme", "documentation", "changelog"],
  ml: ["model", "train", "dataset", "embedding", "inference", "ml"],
}

/** Verbs that map to an expected tool/skill (drives `expected_tools` + `requiredSkills`). */
const TOOL_KEYWORDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  edit: ["edit", "write", "create", "add", "implement", "refactor", "rename", "modify", "update", "fix"],
  read: ["read", "inspect", "review", "open", "look"],
  grep: ["search", "grep", "find", "locate", "scan"],
  bash: ["run", "execute", "build", "compile", "test", "install", "lint"],
}

/** Verbs/nouns that raise `mutation_risk` (irreversible or side-effecting work). */
const MUTATION_TERMS: ReadonlyArray<string> = [
  "write", "delete", "remove", "rm", "drop", "deploy", "publish", "push",
  "migrate", "install", "overwrite", "reset", "truncate", "destroy",
]

/** Terms that raise `ambiguity` (under-specified intent). */
const AMBIGUITY_TERMS: ReadonlyArray<string> = [
  "maybe", "somehow", "etc", "figure", "investigate", "explore", "unclear",
  "probably", "guess", "or", "?", "something", "whatever",
]

/** Terms that raise `security_migration`. */
const SECURITY_TERMS: ReadonlyArray<string> = [
  "auth", "security", "mtls", "tls", "cert", "certificate", "token", "secret",
  "oauth", "jwt", "encrypt", "credential", "migrate", "migration",
]

/** Terms that raise `external_effects` (network / external systems). */
const EXTERNAL_TERMS: ReadonlyArray<string> = [
  "api", "network", "deploy", "http", "https", "request", "email", "publish",
  "webhook", "remote", "upload", "download", "fetch", "endpoint",
]

/** Terms that raise `parallelism` (fan-out friendly). */
const PARALLEL_TERMS: ReadonlyArray<string> = [
  "parallel", "concurrently", "simultaneously", "each", "every", "all of",
  "across", "batch", "fan-out", "fanout",
]

// Saturation scales — the raw count at which a signal reaches 1.0.
const INDEPENDENT_UNITS_SCALE = 6
const MUTATION_SCALE = 3
const AMBIGUITY_SCALE = 3
const SECURITY_SCALE = 3
const EXTERNAL_SCALE = 3
const PARALLEL_SCALE = 3

// =============================================================================
// Pure helpers
// =============================================================================

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Lowercase word tokens (alphanumerics), plus a raw lowercase form for symbols like "?". */
function tokenize(description: string): { words: ReadonlyArray<string>; raw: string } {
  const raw = description.toLowerCase()
  const words = raw.split(/[^a-z0-9+#-]+/).filter((w) => w.length > 0)
  return { words, raw }
}

function countMatches(words: ReadonlyArray<string>, raw: string, terms: ReadonlyArray<string>): number {
  const wordSet = new Set(words)
  let count = 0
  for (const term of terms) {
    // Single-word terms match the token set (whole-word, no substring noise);
    // multi-word or symbol terms fall back to a raw substring probe.
    if (/^[a-z0-9+#-]+$/.test(term)) {
      if (wordSet.has(term)) count += 1
    } else if (raw.includes(term)) {
      count += 1
    }
  }
  return count
}

function domainCount(words: ReadonlyArray<string>, raw: string): number {
  const wordSet = new Set(words)
  let count = 0
  for (const keywords of Object.values(DOMAIN_FAMILIES)) {
    if (keywords.some((k) => (/^[a-z0-9+#-]+$/.test(k) ? wordSet.has(k) : raw.includes(k)))) count += 1
  }
  return Math.max(1, count)
}

/** Independent units ≈ 1 + enumeration signals (", " / " and " / newlines / bullets / " then "). */
function independentUnits(description: string): number {
  const commas = (description.match(/,/g) ?? []).length
  const ands = (description.toLowerCase().match(/\band\b/g) ?? []).length
  const newlines = (description.match(/\n/g) ?? []).length
  const bullets = (description.match(/(^|\n)\s*[-*•]/g) ?? []).length
  const thens = (description.toLowerCase().match(/\bthen\b/g) ?? []).length
  return 1 + commas + ands + newlines + bullets + thens
}

function expectedTools(words: ReadonlyArray<string>): ReadonlyArray<string> {
  const wordSet = new Set(words)
  const tools: string[] = []
  for (const [tool, verbs] of Object.entries(TOOL_KEYWORDS)) {
    if (verbs.some((v) => wordSet.has(v))) tools.push(tool)
  }
  return tools
}

function effortFromScore(score: number): Enums.TaskEffort {
  if (score < 0.2) return "minimal"
  if (score < 0.4) return "low"
  if (score < 0.6) return "medium"
  if (score < 0.8) return "high"
  return "massive"
}

function reasoningFromScore(score: number): Enums.ReasoningEffort {
  if (score < 0.25) return "minimal"
  if (score < 0.5) return "low"
  if (score < 0.75) return "medium"
  return "high"
}

// =============================================================================
// Analyzer
// =============================================================================

/**
 * Build the deterministic, model-free TaskAnalyzer. Optionally accepts lexicon
 * overrides are intentionally omitted here — the defaults above are the open
 * parameter surface; a config-driven policy replaces them wholesale later.
 */
export function createTaskAnalyzer(): TaskAnalyzer {
  return {
    analyze: (input: TaskAnalyzerInput): TaskAnalysis => {
      const description = input.taskDescription ?? ""
      const { words, raw } = tokenize(description)

      // --- structure ---------------------------------------------------------
      const domain_count = domainCount(words, raw)
      const independent_units = independentUnits(description)
      // context_size proxy: byte length of the description (never negative int).
      const context_size = Math.max(0, Math.trunc(description.length))

      // --- concurrency -------------------------------------------------------
      const tools = expectedTools(words)
      const parallelismRaw = countMatches(words, raw, PARALLEL_TERMS) + Math.max(0, independent_units - 1)
      const parallelism = clampUnit(parallelismRaw / PARALLEL_SCALE)

      // --- risk --------------------------------------------------------------
      const mutation_risk = clampUnit(countMatches(words, raw, MUTATION_TERMS) / MUTATION_SCALE)
      const ambiguity = clampUnit(countMatches(words, raw, AMBIGUITY_TERMS) / AMBIGUITY_SCALE)
      const security_migration = clampUnit(countMatches(words, raw, SECURITY_TERMS) / SECURITY_SCALE)
      const external_effects = clampUnit(countMatches(words, raw, EXTERNAL_TERMS) / EXTERNAL_SCALE)

      const inputs: Decision.DecisionInputs = {
        structure: { domain_count, independent_units, context_size },
        risk: { mutation_risk, ambiguity, security_migration, external_effects },
        concurrency: { expected_tools: tools as Decision.ExpectedTools, parallelism },
      }

      // --- hard-gate requirements -------------------------------------------
      // Only require a capability we can positively justify from the text: when
      // the task expects any tool call, the candidate MUST advertise tool-call
      // presence. Everything else stays unknown and the config unknown-policy
      // (deny/allow) governs it — the analyzer never invents requirements.
      const requirements: DimensionRequirements = {}
      if (tools.length > 0) requirements.tool_call_present = true

      // --- ranking criteria --------------------------------------------------
      // Effort scales with breadth + risk; reasoning scales with ambiguity +
      // security sensitivity. Required skills mirror the expected tools so the
      // specialist-agent stage can prefer agents that own those skills.
      const effortScore = clampUnit(
        (domain_count - 1) / 4 + clampUnit((independent_units - 1) / INDEPENDENT_UNITS_SCALE) + mutation_risk,
      )
      const reasoningScore = clampUnit(ambiguity + security_migration)
      const ranking: RankingCriteria = {
        requiredSkills: tools,
        desiredEffort: effortFromScore(effortScore),
        desiredReasoning: reasoningFromScore(reasoningScore),
      }

      return { inputs, requirements, ranking }
    },
  }
}
