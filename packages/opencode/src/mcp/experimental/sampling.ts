/**
 * Feature 008 / T032 (S21) — the server-initiated sampling adapter.
 *
 * Behind the per-server `mcp.sampling` flag (OFF by default). Requires explicit
 * per-agent/per-model `mcp:<server>:sampling` Permission and passes every request
 * through Feature 001 Smart routing, budgets, LangLock, and privacy UNCHANGED —
 * sampling never bypasses them — with the approval path audited (FR45, FR46, C19).
 *
 * Honest seam: the LIVE LLM sampling callback is a DOCUMENTED wiring point where the
 * Feature 001 session runtime would service the request, per the langlock/semantic
 * injection-seam precedent. V1 delivers this adapter + its tests + the seam; the
 * seam may be unreachable until Feature 001 wires the model callback. Its acceptance
 * is the seam test, not a live end-to-end sampling call (C19). Pure over injected
 * flag + permission decision + the (optional) session-runtime callback seam.
 */
export * as McpSampling from "./sampling"

import { Effect } from "effect"
import type { McpSamplingRequest, McpSamplingResult, SamplingDecision } from "@opencode-ai/protocol/mcp/commands"
import type { InteractionError } from "@opencode-ai/protocol/mcp/commands"

export interface SamplingConfig {
  /** The per-server `mcp.sampling` experimental flag; off by default (C19). */
  readonly enabled: boolean
}

/**
 * The Feature 001 session-runtime callback that actually services the sampling
 * request through Smart routing / budgets / LangLock / privacy. This is the honest
 * SEAM — the composition root injects it once Feature 001 wires the model callback;
 * until then it is absent and the adapter reports the typed `unavailable` gap (C19).
 */
export type SessionRuntimeSamplingCallback = (
  request: McpSamplingRequest,
) => Effect.Effect<McpSamplingResult, InteractionError>

export interface SamplingDeps {
  readonly config: SamplingConfig
  /** Read-only permission check for `mcp:<server>:sampling`; fails closed when absent (C19). */
  readonly checkPermission: (request: McpSamplingRequest) => Effect.Effect<boolean, never>
  /** The Feature 001 session-runtime callback; unset = the documented unreachable V1 seam (C19). */
  readonly sessionRuntime?: SessionRuntimeSamplingCallback
  /** Emit the bounded, secret-free approval audit (C19, C26). */
  readonly audit: (decision: SamplingDecision, request: McpSamplingRequest) => Effect.Effect<void>
}

/** Whether the sampling capability is advertised: only when the operator enabled the flag (FR45, C19). */
export const capabilityAdvertised = (config: SamplingConfig): boolean => config.enabled

export interface SamplingAdapter {
  readonly request: (request: McpSamplingRequest) => Effect.Effect<McpSamplingResult, InteractionError>
}

/**
 * Build the sampling adapter. Off → `flag_disabled`; unpermitted →
 * `permission_denied` (fail closed); permitted → route through the Feature 001
 * session-runtime seam (Smart/budget/LangLock/privacy unchanged), auditing the
 * decision. When the seam is unwired the request degrades to `unavailable`, never a
 * bypass (FR46, C19). Pure composition over the injected seams.
 */
export const createSamplingAdapter = (deps: SamplingDeps): SamplingAdapter => ({
  request: (request) => {
    if (!deps.config.enabled) return Effect.fail({ type: "flag_disabled", flag: "sampling" })
    return deps.checkPermission(request).pipe(
      Effect.flatMap((permitted) => {
        if (!permitted) return Effect.fail<InteractionError>({ type: "permission_denied", pattern: `mcp:${request.serverId}:sampling` })
        const runtime = deps.sessionRuntime
        if (!runtime) return Effect.fail<InteractionError>({ type: "unavailable", reason: "Feature 001 session-runtime sampling callback is not wired (documented V1 seam)" })
        return runtime(request).pipe(Effect.tap((result) => deps.audit(result.decision, request)))
      }),
    )
  },
})
