/**
 * Feature 008 / T026 (S16) — the real progress sink replacing the `convertTool`
 * `onprogress: () => {}` no-op.
 *
 * Supplies a progressToken, enforces WIRE monotonicity per token, updates the
 * Feature 002 Process Table child and the Feature 001 OTEL counters, preserves
 * `resetTimeoutOnProgress`, and coalesces/rate-limits DISPLAY frames without
 * rewriting/inventing/decreasing protocol values. Progress NEVER enters LLM
 * context/turns and is never persisted as tool output (FR14, FR15, FR16, FR16a,
 * C7). Pure over injected clock + process/OTEL sinks — no I/O in the decision.
 */
export * as McpProgressSink from "./progress-sink"

/** A wire progress observation from the SDK `onprogress` callback (content-free). */
export interface WireProgress {
  readonly progressToken: string
  readonly progress: number
  readonly total?: number
  readonly message?: string
}

/** The decision for one wire observation; the caller drives UI/Process-Table/OTEL from it (C7). */
export type ProgressDecision =
  | { readonly kind: "accepted"; readonly display: boolean; readonly resetTimeout: true }
  | { readonly kind: "coalesced"; readonly display: false; readonly resetTimeout: true }
  | { readonly kind: "rejected"; readonly reason: "non_monotonic"; readonly display: false; readonly resetTimeout: false }

export interface ProgressSinkDeps {
  readonly nowMillis: () => number
  /** Minimum ms between DISPLAY frames per token; wire values are always processed regardless (FR15). */
  readonly minDisplayIntervalMs: number
  /** Update the Feature 002 Process Table child + Feature 001 OTEL; never receives content (FR16, FR16a). */
  readonly onAccepted?: (event: WireProgress) => void
}

export interface ProgressSink {
  /** Process one wire observation; returns whether to display and to reset the SDK timeout (C7). */
  readonly handle: (event: WireProgress) => ProgressDecision
  /** Mint an opaque, non-secret progressToken to supply to the SDK (FR14). */
  readonly mintToken: (seed: string) => string
}

interface TokenState {
  lastProgress: number
  lastDisplayAt: number
}

/**
 * Build the progress sink. Wire progress MUST increase per token; a non-monotonic
 * observation is rejected (never decreases/invents a value). An accepted
 * observation always resets the SDK progress timeout (`resetTimeoutOnProgress`) and
 * updates Process Table + OTEL; whether it also DISPLAYS is rate-limited (C7).
 */
export const createProgressSink = (deps: ProgressSinkDeps): ProgressSink => {
  const tokens = new Map<string, TokenState>()
  return {
    handle: (event) => {
      const prior = tokens.get(event.progressToken)
      if (prior && event.progress < prior.lastProgress) {
        return { kind: "rejected", reason: "non_monotonic", display: false, resetTimeout: false }
      }
      const now = deps.nowMillis()
      const withinRateLimit = prior !== undefined && now - prior.lastDisplayAt < deps.minDisplayIntervalMs
      tokens.set(event.progressToken, {
        lastProgress: event.progress,
        lastDisplayAt: withinRateLimit ? prior!.lastDisplayAt : now,
      })
      deps.onAccepted?.(event)
      if (withinRateLimit) return { kind: "coalesced", display: false, resetTimeout: true }
      return { kind: "accepted", display: true, resetTimeout: true }
    },
    mintToken: (seed) => `mcp-progress-${seed}-${tokens.size}`,
  }
}
