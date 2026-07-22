import type { AssistantMessage } from "@opencode-ai/sdk/v2"

export type CompletedSubagentUsage = {
  providerID?: string
  modelID?: string
  effort?: string
  tokens?: {
    /** Optional while streaming — paint partial `in` / `out` when only one side is known. */
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
  /**
   * Generation throughput (output+reasoning over wall-clock elapsed).
   * Not (in+out)/time — input is prompt context and multi-turn sum double-counts.
   */
  tokensPerSecond?: number
}

/** Compact token count for the completed task line (e.g. 10.2k). */
export function formatCompactTokenCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/**
 * Derive live child-session token counters without double-counting prompt input.
 * - `input` / latest context: last assistant with a finite input (re-sent each turn).
 * - `output` / `reasoning`: sum across assistants (each turn's generation is additive).
 */
export function deriveAssistantTokenUsage(
  messages: ReadonlyArray<{ role: string; tokens?: AssistantMessage["tokens"] }>,
): { input?: number; output?: number; reasoning?: number } {
  let output = 0
  let reasoning = 0
  let input: number | undefined
  let sawOutput = false
  let sawReasoning = false
  for (const msg of messages) {
    if (msg.role !== "assistant" || !msg.tokens) continue
    if (Number.isFinite(msg.tokens.input) && msg.tokens.input > 0) {
      // Latest prompt size wins — summing multi-turn inputs double-counts context.
      input = msg.tokens.input
    }
    if (Number.isFinite(msg.tokens.output) && msg.tokens.output > 0) {
      output += msg.tokens.output
      sawOutput = true
    }
    if (Number.isFinite(msg.tokens.reasoning) && msg.tokens.reasoning > 0) {
      reasoning += msg.tokens.reasoning
      sawReasoning = true
    }
  }
  return {
    input,
    output: sawOutput ? output : undefined,
    reasoning: sawReasoning ? reasoning : undefined,
  }
}

/** @deprecated Prefer `deriveAssistantTokenUsage`. */
export function sumAssistantTokens(messages: ReadonlyArray<{ role: string; tokens?: AssistantMessage["tokens"] }>) {
  return deriveAssistantTokenUsage(messages)
}

/**
 * Generation throughput: generationTokens / wall-clock seconds.
 * Callers must pass output+reasoning only — never include prompt input.
 * Suppresses rates until ≥100ms elapsed to avoid explosive early spikes.
 */
export function tokensPerSecondFrom(generationTokens: number, durationMs: number): number | undefined {
  if (!Number.isFinite(generationTokens) || generationTokens <= 0) return undefined
  if (!Number.isFinite(durationMs) || durationMs < 100) return undefined
  const rate = generationTokens / (durationMs / 1000)
  if (!Number.isFinite(rate) || rate <= 0) return undefined
  return rate
}

/** Token segment: `2.6k in/773 out`, or partial `2.6k in` / `773 out`. */
export function formatTokenUsageSegment(tokens: NonNullable<CompletedSubagentUsage["tokens"]>): string | undefined {
  const parts: string[] = []
  if (tokens.input !== undefined && Number.isFinite(tokens.input)) {
    parts.push(`${formatCompactTokenCount(tokens.input)} in`)
  }
  if (tokens.output !== undefined && Number.isFinite(tokens.output)) {
    parts.push(`${formatCompactTokenCount(tokens.output)} out`)
  }
  if (parts.length === 0) return undefined
  return parts.join("/")
}

export function formatSubagentToolcalls(count: number) {
  return `${count} toolcall${count === 1 ? "" : "s"}`
}

/**
 * Feature 054 (FR3/AC3) — completed / live subagent detail line.
 * Floor (no usage): byte-identical to pre-054 (`N toolcalls · duration` / bare duration).
 * Segments degrade independently: model without effort, partial tokens, optional out tok/s.
 */
export function formatCompletedSubagentDetail(toolcalls: number, duration: string, usage?: CompletedSubagentUsage) {
  const base = toolcalls === 0 ? duration : `${formatSubagentToolcalls(toolcalls)} · ${duration}`
  if (!usage) return base
  const segments: string[] = []
  if (usage.providerID && usage.modelID) {
    const model = `${usage.providerID}/${usage.modelID}`
    segments.push(usage.effort ? `${model} (${usage.effort})` : model)
  }
  if (usage.tokens) {
    const tokenSeg = formatTokenUsageSegment(usage.tokens)
    if (tokenSeg) segments.push(tokenSeg)
  }
  if (usage.tokensPerSecond !== undefined && Number.isFinite(usage.tokensPerSecond) && usage.tokensPerSecond > 0) {
    // Label out tok/s so it is not read as (in+out)/wall_clock.
    segments.push(`${usage.tokensPerSecond.toFixed(1)} out tok/s`)
  }
  if (segments.length === 0) return base
  return `${base} · ${segments.join(" · ")}`
}
