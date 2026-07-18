/**
 * Feature 003 / T025 (S14) — jobs notification authorization and redaction.
 *
 * The canonical Feature 007 Permission/Policy visibility filter applied BEFORE
 * every notification delivery, observation, and projection (FR21, FR32, C10).
 * It answers one pure question — "may this principal see this notification, and
 * in what redacted form?" — and rejects cross-session/cross-project access as an
 * explicit `cross_scope_leak_rejected` failure verified by AC9, never a silent
 * drop of an explicitly requested scope. It never mutates state, never controls
 * occurrence lifecycle, and never calls a model.
 *
 * Two layers, mirroring `packages/opencode/src/lifecycle/authorization.ts`:
 *   1. `authorizeObserveScope` is the EAGER gate an observation subscription runs
 *      once, from the principal and the requested scope alone: an agent asking to
 *      observe a sibling session or a whole root tree, or a non-operator asking
 *      for the privileged project stream, fails immediately
 *      (`cross_scope_leak_rejected` / `unauthorized`) instead of opening a leaky
 *      stream.
 *   2. `authorizeEnvelope` is the PER-NOTIFICATION filter applied to every
 *      envelope the bounded stream yields or that delivery targets: it confirms
 *      the envelope's target root/session identity is inside the principal's
 *      boundary and returns a redacted envelope, or reports the leak. Sibling and
 *      cross-project envelopes never reach a session/agent principal.
 *
 * Redaction keeps secrets, payloads, spool paths, and full content out of every
 * delivered envelope: the notification envelope already carries only a bounded
 * `summary` plus an opaque Feature 005 `outputRef`, so this module bounds the
 * summary to its byte budget (AC29) and provides a defensive metadata denylist
 * scrub reused by the `job.*` watch surface (FR32).
 */
export * as Authorization from "./authorization"

import type {
  NotificationEnvelope,
  NotificationError,
  NotificationTargetPrincipal,
} from "@opencode-ai/protocol/jobs/commands"

/** The three observation surfaces (mirrors the protocol `NotificationObserveInput.scope`). */
export type NotificationObserveScope = "root" | "session" | "project"

/** The eager scope-gate outcome; a denial carries the exact protocol error. */
export type ScopeDecision =
  | { readonly authorized: true }
  | { readonly authorized: false; readonly error: NotificationError }

/** The per-notification outcome: deliver a redacted view, or report why it is withheld. */
export type EnvelopeDecision =
  | { readonly allowed: true; readonly envelope: NotificationEnvelope }
  | { readonly allowed: false; readonly reason: "cross_scope" | "out_of_scope" }

/** Provisional bounded-summary byte budget (data-model `notification_summary_max_bytes`, AC29). */
export const NOTIFICATION_SUMMARY_MAX_BYTES = 512 as const

const OPERATOR_KINDS: ReadonlySet<string> = new Set(["operator", "manager-view", "system"])

/** True for the Feature 007 operator/manager-view/system principals permitted the privileged surface (C12). */
export function isOperator(principal: NotificationTargetPrincipal): boolean {
  return OPERATOR_KINDS.has(principal.kind)
}

// =============================================================================
// Redaction (FR32, AC29)
// =============================================================================

/** Substrings that mark a metadata key as sensitive and force its removal. */
const SENSITIVE_KEY_PATTERN = /prompt|secret|password|api[_-]?key|token_value|credential|content|result_text|payload|path/i

const encoder = new TextEncoder()

/** Drop any sensitive-looking key from a bounded metadata/detail record (defensive, FR32). */
export function redactRecord(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue
    out[key] = value
  }
  return out
}

/** Bound a summary string to its byte budget, trimming from the end (AC29). */
export function boundSummary(summary: string, maxBytes: number = NOTIFICATION_SUMMARY_MAX_BYTES): string {
  if (encoder.encode(summary).length <= maxBytes) return summary
  let out = summary
  while (out.length > 0 && encoder.encode(out).length > maxBytes) out = out.slice(0, -1)
  return out
}

/** Return the envelope with its summary bounded to the byte budget (AC29); opaque refs are untouched. */
export function redactEnvelope(envelope: NotificationEnvelope): NotificationEnvelope {
  return { ...envelope, summary: boundSummary(envelope.summary) }
}

// =============================================================================
// Eager scope authorization
// =============================================================================

function crossScope(reason: string): ScopeDecision {
  return { authorized: false, error: { type: "cross_scope_leak_rejected", reason } }
}

function unauthorized(reason: string): ScopeDecision {
  return { authorized: false, error: { type: "unauthorized", reason } }
}

/**
 * The eager gate an observation subscription runs once. `scopeId` is the
 * requested scope's addressed id (a `rootSessionId`, `sessionId`, or project
 * ref). Operators may open any surface; per-envelope redaction still applies.
 */
export function authorizeObserveScope(
  principal: NotificationTargetPrincipal,
  scope: NotificationObserveScope,
  scopeId: string,
): ScopeDecision {
  if (isOperator(principal)) return { authorized: true }

  switch (scope) {
    case "project":
      // The privileged project-wide stream requires an operator principal (C10, C12).
      return unauthorized("project observation requires an operator principal")

    case "root": {
      // Only the main context of THAT root tree may observe the whole tree; an
      // agent observing a foreign tree is a cross-scope leak (AC9).
      if (principal.kind === "main-context") {
        return principal.rootSessionId === scopeId
          ? { authorized: true }
          : crossScope(`root tree ${scopeId} is not the principal root ${principal.rootSessionId}`)
      }
      return crossScope("a session-scoped principal cannot observe a whole root tree")
    }

    case "session": {
      if (principal.kind === "main-context") return { authorized: true }
      // An agent may only observe its OWN session; any other session is a leak (AC9).
      if (principal.kind === "agent" && principal.sessionId !== scopeId) {
        return crossScope(`session ${scopeId} is not the principal session ${principal.sessionId}`)
      }
      return { authorized: true }
    }
  }
}

// =============================================================================
// Per-notification authorization + redaction
// =============================================================================

/**
 * The per-notification filter. Confirms the envelope's target root/session
 * identity is inside the principal's boundary, then returns a redacted envelope
 * for delivery, or reports the reason it is withheld. The notification service
 * maps a withheld `cross_scope` to an explicit `cross_scope_leak_rejected`
 * failure on directed delivery/ack (never a silent drop, AC9) and to a silent
 * stream drop on broad observation.
 */
export function authorizeEnvelope(
  principal: NotificationTargetPrincipal,
  envelope: NotificationEnvelope,
): EnvelopeDecision {
  const deliver = (): EnvelopeDecision => ({ allowed: true, envelope: redactEnvelope(envelope) })

  if (isOperator(principal)) return deliver()

  switch (principal.kind) {
    case "main-context":
      // The main context sees its own root tree; a foreign root is cross-scope.
      return envelope.targetRootSessionId === principal.rootSessionId
        ? deliver()
        : { allowed: false, reason: "cross_scope" }

    case "agent":
      // An agent sees only a notification directed at its own session; a null or
      // different target session is out of its boundary.
      return envelope.targetSessionId === principal.sessionId
        ? deliver()
        : { allowed: false, reason: "cross_scope" }

    default:
      return { allowed: false, reason: "out_of_scope" }
  }
}
