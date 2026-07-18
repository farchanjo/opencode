/**
 * Zero-LLM invariant (Feature 007 / T012).
 * Dispatcher/registry path must never invoke provider, model, session prompt, or ToolRegistry.
 * Admin results are never transcript/message types.
 */
import { isAdminResult, isTranscriptLike, type CommandResult } from "@opencode-ai/core/operator"

/** Forbidden dependency surface for the operator admin path. */
export const FORBIDDEN_ADMIN_MODULES = [
  "provider",
  "model",
  "session/prompt",
  "session-prompt",
  "tool-registry",
  "ToolRegistry",
  "llm",
  "aisdk",
  "session.command",
] as const

export type ForbiddenProbe =
  | "provider"
  | "model"
  | "session_prompt"
  | "tool_registry"
  | "llm"
  | "transcript_write"

export type ZeroLlmProbe = {
  readonly record: (probe: ForbiddenProbe, detail?: string) => void
  readonly invocations: () => readonly { probe: ForbiddenProbe; detail?: string }[]
  readonly assertClean: () => void
  readonly reset: () => void
}

/** Create a per-dispatch probe. Tests fail if any forbidden path is recorded. */
export function createZeroLlmProbe(): ZeroLlmProbe {
  const log: { probe: ForbiddenProbe; detail?: string }[] = []
  return {
    record(probe, detail) {
      log.push(detail !== undefined ? { probe, detail } : { probe })
    },
    invocations() {
      return [...log]
    },
    assertClean() {
      if (log.length > 0) {
        const summary = log.map((e) => `${e.probe}${e.detail ? `(${e.detail})` : ""}`).join(", ")
        throw new Error(`zero-LLM invariant violated: ${summary}`)
      }
    },
    reset() {
      log.length = 0
    },
  }
}

/**
 * Static import-path checker for source modules.
 * Only inspects ES module import/export-from lines (not comments or string catalogs).
 */
export function findForbiddenImports(sourceText: string): string[] {
  const importLines = sourceText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(import|export)\b/.test(line) && /\bfrom\s+["']/.test(line))

  const hits: string[] = []
  const patterns: { label: string; re: RegExp }[] = [
    { label: "provider", re: /from\s+["'][^"']*\/provider(?:\/[^"']*)?["']/ },
    { label: "model", re: /from\s+["'][^"']*\/model(?:\/[^"']*)?["']/ },
    { label: "session/prompt", re: /from\s+["'][^"']*session\/prompt[^"']*["']/ },
    { label: "tool-registry", re: /from\s+["'][^"']*(?:tool\/registry|tool-registry|ToolRegistry)[^"']*["']/ },
    { label: "llm", re: /from\s+["'][^"']*\/llm(?:\/[^"']*)?["']/ },
    { label: "aisdk", re: /from\s+["'][^"']*aisdk[^"']*["']/ },
    { label: "session.command", re: /from\s+["'][^"']*session\.command[^"']*["']/ },
  ]
  for (const line of importLines) {
    for (const p of patterns) {
      if (p.re.test(line) && !hits.includes(p.label)) hits.push(p.label)
    }
  }
  return hits
}

/** Assert admin result shape and reject transcript-like envelopes. */
export function assertAdminResultShape(result: CommandResult): void {
  if (!isAdminResult(result)) {
    throw new Error("operator result must be kind=operator.admin_result")
  }
  if (isTranscriptLike(result)) {
    throw new Error("operator admin result must never be a transcript/message type")
  }
  if (result.kind !== "operator.admin_result") {
    throw new Error(`unexpected result kind: ${String(result.kind)}`)
  }
}

/**
 * Handler port wrappers must not call LLM. This sentinel throws when a fake
 * provider is invoked during admin dispatch tests.
 */
export function createForbiddenLlmPort(): {
  invokeProvider: () => never
  invokeModel: () => never
  invokeSessionPrompt: () => never
  invokeToolRegistry: () => never
  probe: ZeroLlmProbe
} {
  const probe = createZeroLlmProbe()
  return {
    probe,
    invokeProvider() {
      probe.record("provider")
      throw new Error("provider must not be invoked on operator admin path")
    },
    invokeModel() {
      probe.record("model")
      throw new Error("model must not be invoked on operator admin path")
    },
    invokeSessionPrompt() {
      probe.record("session_prompt")
      throw new Error("session prompt must not be invoked on operator admin path")
    },
    invokeToolRegistry() {
      probe.record("tool_registry")
      throw new Error("ToolRegistry must not be invoked on operator admin path")
    },
  }
}

export * as OperatorZeroLlm from "./zero-llm"
