/**
 * Main-context console chat budget: soft system instruction + hard stream cap
 * on assistant *text* only (tool-call payloads / file writes are unaffected).
 */
import { Token } from "@/util/token"

export type ChatOutputConfig = {
  readonly max_words?: number
  readonly max_tokens?: number
}

export type ChatBudget = {
  readonly maxWords?: number
  readonly maxTokens?: number
  exhausted: boolean
}

export function resolveChatBudget(cfg: ChatOutputConfig | undefined | null): ChatBudget | undefined {
  if (!cfg) return undefined
  const maxWords = typeof cfg.max_words === "number" && cfg.max_words > 0 ? cfg.max_words : undefined
  const maxTokens = typeof cfg.max_tokens === "number" && cfg.max_tokens > 0 ? cfg.max_tokens : undefined
  if (!maxWords && !maxTokens) return undefined
  return { maxWords, maxTokens, exhausted: false }
}

export function wordCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/** Clamp text to word/token budgets. Returns the allowed prefix and whether the cap was hit. */
export function applyChatBudget(
  text: string,
  budget: Pick<ChatBudget, "maxWords" | "maxTokens">,
): { text: string; exhausted: boolean } {
  let out = text
  let exhausted = false

  if (budget.maxTokens !== undefined) {
    // Token.estimate is chars/≈4; walk word boundaries where possible.
    if (Token.estimate(out) > budget.maxTokens) {
      exhausted = true
      // Binary search for longest prefix within token budget.
      let lo = 0
      let hi = out.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (Token.estimate(out.slice(0, mid)) <= budget.maxTokens) lo = mid
        else hi = mid - 1
      }
      out = out.slice(0, lo)
    }
  }

  if (budget.maxWords !== undefined) {
    const words = out.trim() ? out.trim().split(/\s+/) : []
    if (words.length > budget.maxWords) {
      exhausted = true
      // Preserve leading whitespace shape of original when possible.
      const lead = out.match(/^\s*/)?.[0] ?? ""
      out = lead + words.slice(0, budget.maxWords).join(" ")
    }
  }

  return { text: out, exhausted }
}

/** System block injected for primary agents when chat_output is configured. */
export function chatOutputSystemBlock(cfg: ChatOutputConfig): string {
  const parts: string[] = []
  if (typeof cfg.max_words === "number" && cfg.max_words > 0) {
    parts.push(`at most ${cfg.max_words} words`)
  }
  if (typeof cfg.max_tokens === "number" && cfg.max_tokens > 0) {
    parts.push(`at most ${cfg.max_tokens} tokens`)
  }
  if (parts.length === 0) return ""
  return [
    "## Console chat output budget (enforced)",
    `Your final user-facing *chat text* in this turn must be ${parts.join(" and ")}.`,
    "This limit applies only to console chat prose. It does NOT apply to tool call arguments,",
    "file contents in write/edit/apply_patch tools, or any other non-chat payload.",
    "Prefer dense, complete sentences within the budget. Stop when the budget is reached.",
  ].join("\n")
}
