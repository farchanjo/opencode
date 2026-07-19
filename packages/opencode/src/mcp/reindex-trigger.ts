/**
 * Feature 008 / T035 (S23) — the single opt-in semantic-index trigger seam.
 *
 * On a qualifying `resources/updated` (per the T017 resource policy) with operator
 * opt-in AND a Feature 006 classification decision, emit EXACTLY ONE reindex trigger
 * consumed by Feature 006 under its admission ladder. Feature 008 never embeds,
 * ranks, or stores vectors — it only emits the trigger the Feature 006 stack and the
 * Feature 009 tool-search reference (FR53, C21).
 *
 * Honest seam: the LIVE Feature 006 consumption is a documented wiring point — the
 * trigger may be unreachable until Feature 006 wires the consumer, per the
 * langlock/semantic injection-seam precedent. Its acceptance is the seam test, not a
 * live end-to-end reindex. Pure and deterministic over the injected decision inputs.
 */
export * as McpReindexTrigger from "./reindex-trigger"

import type { ServerId } from "@opencode-ai/schema/mcp/ids"
import type { ResourceUri } from "@opencode-ai/schema/mcp/uri"

/** The gate inputs for one qualifying `resources/updated` observation (content-free). */
export interface ReindexGate {
  /** The operator opted this server's resource updates into semantic reindex (C21). */
  readonly operatorOptIn: boolean
  /** Feature 006 classified this update as index-relevant (its admission decision, C21). */
  readonly classificationRelevant: boolean
  /** The update qualified under the T017 resource policy (notify+cache rung reached). */
  readonly policyQualified: boolean
}

/** One reindex trigger — opaque ids only; Feature 006 owns the vectors (FR53, C21). */
export interface ReindexTrigger {
  readonly serverId: ServerId
  readonly resourceUri: ResourceUri
  readonly correlationId: string
}

export type ReindexDecision =
  | { readonly fire: true; readonly trigger: ReindexTrigger }
  | { readonly fire: false; readonly reason: "not_opted_in" | "not_classified" | "not_qualified" }

/**
 * Decide whether to emit the single reindex trigger. It fires only when the operator
 * opted in AND Feature 006 classified the update AND the resource policy qualified it
 * — never auto-fires. At most one trigger per qualifying update (FR53, C21). Pure.
 */
export function planReindex(
  gate: ReindexGate,
  subject: { readonly serverId: ServerId; readonly resourceUri: ResourceUri; readonly correlationId: string },
): ReindexDecision {
  if (!gate.operatorOptIn) return { fire: false, reason: "not_opted_in" }
  if (!gate.classificationRelevant) return { fire: false, reason: "not_classified" }
  if (!gate.policyQualified) return { fire: false, reason: "not_qualified" }
  return { fire: true, trigger: { serverId: subject.serverId, resourceUri: subject.resourceUri, correlationId: subject.correlationId } }
}
