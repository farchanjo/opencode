/**
 * Feature 008 / T020 (S12) — the typed capability-gap classifier.
 *
 * Encodes the C1/C2 degradation stance drawn in `plan.md` and `enums.cue`'s
 * `CapabilityGap` (FR7, C1, C2). Pure and deterministic, no I/O, mirroring
 * `packages/core/src/semantic/degradation.ts`. A missing SDK/wire feature or an
 * unreachable server degrades to a TYPED gap and the session CONTINUES rather than
 * hard-failing; an unadvertised capability is never exercised. `mcp_unavailable`
 * never crashes the session (FR7, C1, C2).
 */
export * as Degradation from "./degradation"

import type { CapabilityGap } from "@opencode-ai/schema/mcp/enums"

export type { CapabilityGap }

/** The observed capability conditions feeding the classifier; all `false`/present = healthy. */
export interface CapabilityConditions {
  /** The server is unreachable or the SDK client surface is absent (C1, C2). */
  readonly serverUnreachable: boolean
  /** A required optional wire feature is unsupported by the SDK/server (C1). */
  readonly featureUnsupported: boolean
  /** The connection needs OAuth before use (C2). */
  readonly needsAuth: boolean
  /** The connection needs dynamic client registration before use (C2). */
  readonly needsClientRegistration: boolean
}

/** A healthy condition set — no gap applies (C2). */
export const HEALTHY_CONDITIONS: CapabilityConditions = Object.freeze({
  serverUnreachable: false,
  featureUnsupported: false,
  needsAuth: false,
  needsClientRegistration: false,
})

/**
 * The gap-code precedence, most fundamental first. When several conditions hold the
 * classifier reports the single most severe gap so the operator sees the root
 * cause; an unreachable server outranks a missing feature (FR7, C2).
 */
export const GAP_PRECEDENCE: ReadonlyArray<Exclude<CapabilityGap, "none">> = Object.freeze([
  "mcp_unavailable",
  "needs_auth",
  "needs_client_registration",
  "feature_unsupported",
])

/** The stable, content-free reason string for each gap code (FR7, C2). */
const GAP_REASON: Readonly<Record<Exclude<CapabilityGap, "none">, string>> = Object.freeze({
  mcp_unavailable: "the MCP server is unreachable or the SDK client surface is absent",
  needs_auth: "the connection requires OAuth before use",
  needs_client_registration: "the connection requires dynamic client registration before use",
  feature_unsupported: "a required optional wire feature is unsupported",
})

/** Which condition maps to each gap code, in precedence order (FR7, C2). */
const CONDITION_FOR: Readonly<Record<Exclude<CapabilityGap, "none">, keyof CapabilityConditions>> = Object.freeze({
  mcp_unavailable: "serverUnreachable",
  needs_auth: "needsAuth",
  needs_client_registration: "needsClientRegistration",
  feature_unsupported: "featureUnsupported",
})

/** The typed degradation outcome; the session continues on any non-`none` gap (FR7, C1, C2). */
export interface DegradationOutcome {
  readonly gap: CapabilityGap
  readonly degraded_reason: string | null
  /** Whether the session continues — ALWAYS true, no gap hard-fails (FR7, C1, C2). */
  readonly session_continues: true
}

/** The healthy outcome (no gap). */
export const HEALTHY: DegradationOutcome = Object.freeze({ gap: "none", degraded_reason: null, session_continues: true })

/**
 * Classify the observed capability conditions into a typed gap outcome. A healthy
 * set stays `none`; any condition maps to the most-severe stable gap code with its
 * content-free reason. The session ALWAYS continues — no gap crashes it (FR7, C1,
 * C2). Pure and total.
 */
export const classify = (conditions: CapabilityConditions): DegradationOutcome => {
  const gap = GAP_PRECEDENCE.find((code) => conditions[CONDITION_FOR[code]]) ?? null
  if (gap === null) return HEALTHY
  return Object.freeze({ gap, degraded_reason: GAP_REASON[gap], session_continues: true })
}

/**
 * Whether a capability may be exercised: only when the recorded set advertised it
 * AND no gap applies. An unadvertised or degraded capability is never exercised
 * (FR7, C2). Pure.
 */
export const capabilityExercisable = (advertised: boolean, gap: CapabilityGap): boolean => advertised && gap === "none"
