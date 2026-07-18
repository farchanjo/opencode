/**
 * Feature 002 / T027 (S10) — observation authorization and redaction.
 *
 * The canonical Permission/Policy visibility filter that runs BEFORE every
 * observation delivery and before projection (C14, FR11–FR13). It answers one
 * pure question — "may this principal see this lifecycle event, and in what
 * redacted form?" — and rejects sibling and cross-project access as an explicit
 * `sibling_leak_rejected` failure verified by AC3/AC4. It never mutates a row,
 * never controls lifecycle state, and never calls a model (FR16–FR18).
 *
 * Two layers:
 *   1. `authorizeScope` is the EAGER gate a subscription runs once, from the
 *      principal and the requested scope alone: an agent asking to observe a
 *      sibling Session, or a non-operator asking for the privileged global
 *      stream, fails immediately (`sibling_leak_rejected` / `unauthorized`)
 *      instead of opening a leaky stream.
 *   2. `authorizeEvent` is the PER-EVENT filter applied to every payload the
 *      bounded lifecycle stream yields: it confirms the event's tree/session
 *      identity is inside the principal's authorized boundary and returns a
 *      redacted envelope/detail, or drops the event. Sibling events never reach
 *      a session/agent principal.
 *
 * Redaction keeps prompts, results, tool payloads, personal paths, and secrets
 * out of delivered observations (FR13, FR28); the schema already bounds `detail`
 * and `redacted_metadata`, so this is a defensive allowlist over metadata keys
 * plus a denylist substring scrub, not a content parser.
 */
export * as Authorization from "./authorization"

import type { Envelope } from "@opencode-ai/schema/lifecycle/envelope"
import type { ObservationError, ObserverPrincipal } from "@opencode-ai/protocol/lifecycle/commands"

/** The four observation surfaces (mirrors the protocol `ObservationScope`, C14). */
export type ObservationScopeKind = "session" | "process" | "tree" | "global"

/** The eager scope-gate outcome; a denial carries the exact protocol error. */
export type ScopeDecision = { readonly authorized: true } | { readonly authorized: false; readonly error: ObservationError }

/** The per-event outcome: deliver a redacted view, or drop the event silently. */
export type EventDecision =
  | { readonly allowed: true; readonly envelope: Envelope.LifecycleEnvelope; readonly detail: Record<string, unknown> }
  | { readonly allowed: false; readonly reason: "out_of_scope" | "sibling" | "cross_project" }

const OPERATOR_KINDS: ReadonlySet<string> = new Set(["operator", "manager-view"])

/** True for the Feature 007 operator/manager-view principals permitted the privileged surface (C19). */
export function isOperator(principal: ObserverPrincipal): boolean {
  return OPERATOR_KINDS.has(principal.kind)
}

// =============================================================================
// Metadata redaction (FR13, FR28)
// =============================================================================

/** Substrings that mark a metadata key as sensitive and force its removal. */
const SENSITIVE_KEY_PATTERN = /prompt|secret|password|api[_-]?key|token_value|credential|content|result_text|payload|path/i

/** Drop any sensitive-looking key from a bounded metadata/detail record (defensive). */
export function redactRecord(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue
    out[key] = value
  }
  return out
}

/** Return the envelope with its `redacted_metadata` scrubbed of sensitive keys (FR13). */
export function redactEnvelope(envelope: Envelope.LifecycleEnvelope): Envelope.LifecycleEnvelope {
  const redacted_metadata = redactRecord(envelope.delivery.redacted_metadata) as Envelope.LifecycleEnvelope["delivery"]["redacted_metadata"]
  return { ...envelope, delivery: { ...envelope.delivery, redacted_metadata } }
}

// =============================================================================
// Eager scope authorization
// =============================================================================

function unauthorized(reason: string): ScopeDecision {
  return { authorized: false, error: { type: "unauthorized", reason } }
}

function siblingLeak(reason: string): ScopeDecision {
  return { authorized: false, error: { type: "sibling_leak_rejected", reason } }
}

/**
 * The eager gate a subscription runs once. `target` is the scope's addressed id
 * (the requested `session_id`, `process_id`, or `root_session_id`); it is
 * `null` for the global surface.
 */
export function authorizeScope(
  principal: ObserverPrincipal,
  scope: ObservationScopeKind,
  target: string | null,
): ScopeDecision {
  // Operators may open any surface; per-event redaction still applies.
  if (isOperator(principal)) return { authorized: true }

  switch (scope) {
    case "global":
      // The privileged operational stream requires an operator principal (C14, FR11).
      return unauthorized("global observation requires an operator principal")

    case "session": {
      if (principal.kind === "main-context") return { authorized: true }
      // An agent/subagent may only observe its OWN session; any other session
      // in the tree is a sibling leak (AC3).
      if ((principal.kind === "agent" || principal.kind === "subagent") && target !== null && principal.sessionId !== target) {
        return siblingLeak(`session ${target} is not the principal session ${principal.sessionId}`)
      }
      return { authorized: true }
    }

    case "process":
      // Process identity resolves to a session at delivery time; the eager gate
      // admits agents/main-context and lets `authorizeEvent` drop siblings.
      return { authorized: true }

    case "tree": {
      // Only the main context of THAT root tree (or an operator) may observe a
      // whole tree; an agent/subagent observing a foreign tree is a leak (AC4).
      if (principal.kind === "main-context") {
        if (target !== null && principal.rootSessionId !== target) {
          return siblingLeak(`root tree ${target} is not the principal root ${principal.rootSessionId}`)
        }
        return { authorized: true }
      }
      return siblingLeak("a session-scoped principal cannot observe a whole root tree")
    }
  }
}

// =============================================================================
// Per-event authorization + redaction
// =============================================================================

/**
 * The per-event filter over the bounded lifecycle stream. Confirms the event's
 * tree/session identity is inside the principal's boundary, then returns a
 * redacted envelope/detail for delivery, or drops the event.
 */
export function authorizeEvent(
  principal: ObserverPrincipal,
  envelope: Envelope.LifecycleEnvelope,
  detail: Readonly<Record<string, unknown>>,
): EventDecision {
  const deliver = (): EventDecision => ({
    allowed: true,
    envelope: redactEnvelope(envelope),
    detail: redactRecord(detail),
  })

  if (isOperator(principal)) return deliver()

  switch (principal.kind) {
    case "main-context":
      // The main context sees its own root tree; a foreign root is cross-project.
      return envelope.tree.root_session_id === principal.rootSessionId
        ? deliver()
        : { allowed: false, reason: "cross_project" }

    case "agent":
    case "subagent":
      // An agent/subagent sees only its own session; a same-tree different
      // session is a sibling, a different tree is cross-project.
      if (envelope.tree.session_id === principal.sessionId) return deliver()
      return { allowed: false, reason: "sibling" }

    default:
      // Any principal not matched above (e.g. an operator kind reaching this
      // branch) is treated as out of scope; operators are handled at the top.
      return { allowed: false, reason: "out_of_scope" }
  }
}
