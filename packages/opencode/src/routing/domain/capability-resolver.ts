/**
 * CapabilityResolver — resolves the seven tool-call capability dimensions
 * for a candidate from canonical catalog metadata, applies validated
 * override overlays (source/confidence/TTL), and enforces the conservative
 * unknown-capability policy (spec.md FR41-FR47, scenarios 27-32/34-40).
 *
 * Layer precedence (open parameter, documented default): "override" then
 * "observed" then "catalog". Canonical catalog metadata ("catalog") is
 * always the base layer and never expires; "override" and "observed"
 * overlays are excluded once their TTL elapses (scenario 31, "capability
 * learning expiry") and the resolver falls through to the next layer.
 *
 * Pure domain module: no I/O, no Effect services. Consumes/produces the
 * routing schema types (Capability.Record, Capability.Mismatch).
 */

import type { Capability } from "@opencode-ai/schema/routing/capability"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"

export type DimensionName = keyof Capability.ToolCallDimensions

// Declared in hard-gate order (spec.md FR41): presence, calls-per-turn,
// same-turn multiple calls, serial runner execution, parallel calls,
// continuation after tool result, multi-turn cycles.
export const DIMENSION_NAMES: ReadonlyArray<DimensionName> = [
  "tool_call_present",
  "max_calls_per_turn",
  "same_turn_multiple_calls",
  "serial_runner_execution",
  "parallel_calls",
  "continuation_after_tool_result",
  "multi_turn_cycles",
]

// Only max_calls_per_turn is a numeric (uint) dimension; the rest are boolean.
export const NUMERIC_DIMENSIONS: ReadonlySet<DimensionName> = new Set(["max_calls_per_turn"])

export const DEFAULT_LAYER_PRECEDENCE: ReadonlyArray<Capability.Source> = ["override", "observed"]

// --- Freshness --------------------------------------------------------------

/**
 * True when `layer` has not exceeded its freshness TTL relative to `nowIso`.
 * Canonical catalog metadata is exempt (callers never need to freshness-gate
 * the base layer); this check only matters for override/observed overlays.
 */
export function isLayerFresh(layer: Capability.Record, nowIso: string): boolean {
  const expiresAt = Date.parse(layer.freshness.timestamp) + layer.freshness.ttl_ms
  const now = Date.parse(nowIso)
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) return false
  return now < expiresAt
}

// --- Resolution ---------------------------------------------------------

function resolveDimensions(layers: ReadonlyArray<Capability.Record>): Capability.ToolCallDimensions {
  const dimensions: Record<DimensionName, Capability.ToolCapabilityValue> = {
    tool_call_present: null,
    max_calls_per_turn: null,
    same_turn_multiple_calls: null,
    serial_runner_execution: null,
    parallel_calls: null,
    continuation_after_tool_result: null,
    multi_turn_cycles: null,
  }

  for (const dimension of DIMENSION_NAMES) {
    for (const layer of layers) {
      const value = layer.assessment.dimensions[dimension]
      if (value !== null) {
        dimensions[dimension] = value
        break
      }
    }
  }

  return dimensions as Capability.ToolCallDimensions
}

/**
 * Merge canonical catalog metadata with validated override/observed
 * overlays into a single resolved Capability.Record. Per dimension, the
 * highest-precedence fresh layer that declares a non-null value wins; a
 * dimension unresolved by any layer remains `null` (unknown) rather than
 * being promoted to supported (spec.md FR47).
 *
 * `catalog` MUST be canonical metadata (spec.md FR42: "Routing MUST use
 * canonical capability metadata first and MUST NOT create a parallel
 * capability catalog"); `overlays` are validated global/project overrides
 * and/or an observed capability overlay, each tagged with its own source.
 */
export function resolveCapabilityRecord(
  catalog: Capability.Record,
  overlays: ReadonlyArray<Capability.Record>,
  now: string,
  precedence: ReadonlyArray<Capability.Source> = DEFAULT_LAYER_PRECEDENCE,
): Capability.Record {
  const overlaysBySource = new Map<Capability.Source, Capability.Record>()
  for (const overlay of overlays) overlaysBySource.set(overlay.assessment.source, overlay)

  const freshOverlays = precedence
    .map((source) => overlaysBySource.get(source))
    .filter((layer): layer is Capability.Record => layer !== undefined && isLayerFresh(layer, now))

  const candidateLayers = [...freshOverlays, catalog]
  const primary = candidateLayers[0] ?? catalog

  return {
    identity: catalog.identity,
    assessment: {
      dimensions: resolveDimensions(candidateLayers),
      source: primary.assessment.source,
      confidence: primary.assessment.confidence,
    },
    freshness: primary.freshness,
  }
}

// --- Conservative unknown policy + gate evaluation -----------------------

export interface DimensionEvaluation {
  readonly met: boolean
  readonly reason: string
}

/**
 * Evaluate a single resolved dimension value against a task requirement,
 * applying the conservative unknown policy: under "deny" a `null`
 * (unknown) value counts as unmet; under "allow" it is treated as met
 * (spec.md scenario 29, "Conservative unknown capability").
 *
 * `requirement === null` (or `false` for boolean dimensions) means the
 * task does not require this dimension — always met.
 */
export function evaluateDimension(
  dimension: DimensionName,
  value: Capability.ToolCapabilityValue,
  requirement: Capability.ToolCapabilityValue,
  unknownPolicy: RoutingConfig.UnknownPolicy,
): DimensionEvaluation {
  if (requirement === null || requirement === false) {
    return { met: true, reason: "not_required" }
  }

  if (value === null) {
    return unknownPolicy === "deny"
      ? { met: false, reason: "capability_unknown_deny" }
      : { met: true, reason: "capability_unknown_allow" }
  }

  if (NUMERIC_DIMENSIONS.has(dimension)) {
    if (typeof value !== "number" || typeof requirement !== "number") {
      return { met: false, reason: "capability_type_mismatch" }
    }
    return value >= requirement
      ? { met: true, reason: "capability_satisfied" }
      : { met: false, reason: "capability_below_requirement" }
  }

  if (typeof value !== "boolean" || typeof requirement !== "boolean") {
    return { met: false, reason: "capability_type_mismatch" }
  }

  return value === true
    ? { met: true, reason: "capability_satisfied" }
    : { met: false, reason: "capability_unsupported" }
}

/**
 * Render a raw dimension requirement as the human-readable description
 * expected by Capability.Mismatch.requirement (Ids.Requirement is a
 * descriptive string, distinct from the structured candidate value it is
 * compared against).
 */
export function describeRequirement(dimension: DimensionName, requirement: Capability.ToolCapabilityValue): string {
  if (requirement === null) return `${dimension}: not required`
  if (NUMERIC_DIMENSIONS.has(dimension)) return `${dimension} >= ${String(requirement)}`
  return `${dimension} == ${String(requirement)}`
}

/** Construct a Capability.Mismatch record for an unmet dimension. */
export function toMismatch(
  dimension: DimensionName,
  requirement: Capability.ToolCapabilityValue,
  value: Capability.ToolCapabilityValue,
  scope: Capability.Scope,
  reason: Capability.Reason,
  outcome: Capability.MismatchOutcome = "hard_gate_reject",
): Capability.Mismatch {
  return {
    dimension,
    requirement: describeRequirement(dimension, requirement),
    candidate_value: value,
    reason,
    scope,
    outcome,
  }
}

export interface CandidateCapabilityEvaluation {
  readonly record: Capability.Record
  readonly mismatches: ReadonlyArray<Capability.Mismatch>
}

/**
 * Resolve a candidate's capability record and evaluate it against a task's
 * per-dimension requirements in one pass, applying the conservative unknown
 * policy. Dimensions absent from `requirements` are treated as not required.
 */
export function resolveAndEvaluate(
  catalog: Capability.Record,
  overlays: ReadonlyArray<Capability.Record>,
  requirements: Partial<Record<DimensionName, Capability.ToolCapabilityValue>>,
  unknownPolicy: RoutingConfig.UnknownPolicy,
  now: string,
  precedence: ReadonlyArray<Capability.Source> = DEFAULT_LAYER_PRECEDENCE,
): CandidateCapabilityEvaluation {
  const record = resolveCapabilityRecord(catalog, overlays, now, precedence)
  const scope = record.freshness.scope
  const mismatches: Capability.Mismatch[] = []

  for (const dimension of DIMENSION_NAMES) {
    const requirement = requirements[dimension] ?? null
    const value = record.assessment.dimensions[dimension]
    const evaluation = evaluateDimension(dimension, value, requirement, unknownPolicy)
    if (!evaluation.met) {
      mismatches.push(toMismatch(dimension, requirement, value, scope, evaluation.reason))
    }
  }

  return { record, mismatches }
}
