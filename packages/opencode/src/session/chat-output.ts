/**
 * Main-context console chat budget: the model is instructed to *compose* within
 * the limit. No stream filtering — the LLM adjusts its own answer.
 * Does not apply to tool-call arguments or file write/edit payloads.
 */

export type ChatOutputConfig = {
  readonly max_words?: number
  readonly max_tokens?: number
}

export function hasChatOutputBudget(cfg: ChatOutputConfig | undefined | null): boolean {
  if (!cfg) return false
  const words = typeof cfg.max_words === "number" && cfg.max_words > 0
  const tokens = typeof cfg.max_tokens === "number" && cfg.max_tokens > 0
  return words || tokens
}

export function wordCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/**
 * System block for primary agents: soft contract so the model self-sizes the
 * console reply. Never hard-truncate downstream of generation.
 */
export function chatOutputSystemBlock(cfg: ChatOutputConfig): string {
  const parts: string[] = []
  if (typeof cfg.max_words === "number" && cfg.max_words > 0) {
    parts.push(`${cfg.max_words} words`)
  }
  if (typeof cfg.max_tokens === "number" && cfg.max_tokens > 0) {
    parts.push(`~${cfg.max_tokens} tokens`)
  }
  if (parts.length === 0) return ""
  const limit = parts.join(" and ")
  return [
    "## Console chat length (main context)",
    `Compose your final user-facing *chat text* so it fits within ${limit}.`,
    "You MUST self-edit: prioritize the direct answer, drop fluff, stay complete within the budget.",
    "Do NOT ramble past the limit — finish the answer early if needed.",
    "This budget applies ONLY to console chat prose in the main context.",
    "It does NOT apply to tool-call arguments, write/edit/apply_patch file bodies, or subagent task prompts.",
  ].join("\n")
}
