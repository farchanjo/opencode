/**
 * Classifier — deterministic task_class + routing_profile from structured
 * evaluation signals. No model call.
 *
 * Mirrors the "Classifier" node of the Routing Decision Pipeline in
 * doc/arch/sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/hierarchy-flow.md:
 * domain count, independent units, mutation/risk, ambiguity, context size,
 * expected tools, parallelism, security/migration -> task_class ->
 * routing_profile (direct_worker | manager).
 *
 * Pure domain module: no I/O, no Effect services. Consumes/produces the
 * routing schema types (Decision.DecisionInputs, Enums.TaskClass,
 * Enums.RoutingProfile).
 *
 * Exact numeric thresholds and weights are an open clarification parameter
 * (spec.md "Open Parameters" / hierarchy-flow.md "Open Parameters" -
 * "Classifier thresholds"). The defaults below are a deliberate, documented
 * baseline exported as data so a future config-driven override (routing
 * policy) can replace them without touching the algorithm.
 */

import type { Decision } from "@opencode-ai/schema/routing/decision"
import type { Enums } from "@opencode-ai/schema/routing/enums"

// --- Thresholds (open parameter defaults) -------------------------------

export interface ClassifierThresholds {
  /** domain_count value at which the domain-count signal saturates to 1.0. */
  readonly domainCountScale: number
  /** independent_units value at which the independent-units signal saturates to 1.0. */
  readonly independentUnitsScale: number
  /** context_size value at which the context-size signal saturates to 1.0. */
  readonly contextSizeScale: number
  /** expected_tools count at which the expected-tools signal saturates to 1.0. */
  readonly expectedToolsScale: number
  /** Composite-score boundaries separating small/medium/large/complex. */
  readonly taskClassBoundaries: {
    readonly medium: number
    readonly large: number
    readonly complex: number
  }
  /** Minimum domain_count for a task to be considered decomposable. */
  readonly managerDomainCount: number
  /** Minimum independent_units for a task to be considered decomposable. */
  readonly managerIndependentUnits: number
  /** Minimum parallelism signal for a task to favor Manager fanout. */
  readonly managerParallelism: number
}

export const DEFAULT_CLASSIFIER_THRESHOLDS: ClassifierThresholds = {
  domainCountScale: 4,
  independentUnitsScale: 5,
  contextSizeScale: 50_000,
  expectedToolsScale: 6,
  taskClassBoundaries: { medium: 0.25, large: 0.5, complex: 0.75 },
  managerDomainCount: 2,
  managerIndependentUnits: 2,
  managerParallelism: 0.5,
}

// Relative weight of each normalized signal in the composite complexity
// score. Sums to 1.0. security/migration folds in external_effects (both
// risk.cue dimensions map to the single "security/migration" evaluation
// signal named in hierarchy-flow.md).
const SIGNAL_WEIGHTS = {
  domainCount: 0.15,
  independentUnits: 0.15,
  contextSize: 0.1,
  expectedTools: 0.1,
  mutationRisk: 0.15,
  ambiguity: 0.1,
  securityMigration: 0.15,
  parallelism: 0.1,
} as const

// --- Signals --------------------------------------------------------------

export interface ClassificationSignals {
  readonly domainCount: number
  readonly independentUnits: number
  readonly contextSize: number
  readonly expectedTools: number
  readonly mutationRisk: number
  readonly ambiguity: number
  readonly securityMigration: number
  readonly parallelism: number
}

export interface ClassificationResult {
  readonly taskClass: Enums.TaskClass
  readonly routingProfile: Enums.RoutingProfile
  /** Composite complexity score in [0,1] driving the task_class boundary. */
  readonly complexityScore: number
  /** Per-signal normalized [0,1] contributions, for explain/telemetry. */
  readonly signals: ClassificationSignals
  readonly reason: string
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function scaleUnit(value: number, scale: number): number {
  if (scale <= 0) return 0
  return clampUnit(value / scale)
}

function deriveSignals(inputs: Decision.DecisionInputs, thresholds: ClassifierThresholds): ClassificationSignals {
  return {
    domainCount: scaleUnit(inputs.structure.domain_count, thresholds.domainCountScale),
    independentUnits: scaleUnit(inputs.structure.independent_units, thresholds.independentUnitsScale),
    contextSize: scaleUnit(inputs.structure.context_size, thresholds.contextSizeScale),
    expectedTools: scaleUnit(inputs.concurrency.expected_tools.length, thresholds.expectedToolsScale),
    mutationRisk: clampUnit(inputs.risk.mutation_risk),
    ambiguity: clampUnit(inputs.risk.ambiguity),
    securityMigration: clampUnit(Math.max(inputs.risk.security_migration, inputs.risk.external_effects)),
    parallelism: clampUnit(inputs.concurrency.parallelism),
  }
}

function compositeScore(signals: ClassificationSignals): number {
  return (
    signals.domainCount * SIGNAL_WEIGHTS.domainCount +
    signals.independentUnits * SIGNAL_WEIGHTS.independentUnits +
    signals.contextSize * SIGNAL_WEIGHTS.contextSize +
    signals.expectedTools * SIGNAL_WEIGHTS.expectedTools +
    signals.mutationRisk * SIGNAL_WEIGHTS.mutationRisk +
    signals.ambiguity * SIGNAL_WEIGHTS.ambiguity +
    signals.securityMigration * SIGNAL_WEIGHTS.securityMigration +
    signals.parallelism * SIGNAL_WEIGHTS.parallelism
  )
}

function taskClassFromScore(score: number, boundaries: ClassifierThresholds["taskClassBoundaries"]): Enums.TaskClass {
  if (score < boundaries.medium) return "small"
  if (score < boundaries.large) return "medium"
  if (score < boundaries.complex) return "large"
  return "complex"
}

// direct_worker: small/bounded. manager: complex/decomposable (hierarchy-flow.md).
// "Decomposable" means multiple independent units across multiple domains, or
// high task parallelism that benefits from Manager fanout admission.
function routingProfileFromClass(
  taskClass: Enums.TaskClass,
  inputs: Decision.DecisionInputs,
  thresholds: ClassifierThresholds,
): Enums.RoutingProfile {
  const decomposable =
    inputs.structure.domain_count >= thresholds.managerDomainCount &&
    inputs.structure.independent_units >= thresholds.managerIndependentUnits
  const highlyParallel = inputs.concurrency.parallelism >= thresholds.managerParallelism

  if (taskClass === "complex") return "manager"
  if (taskClass === "large" && (decomposable || highlyParallel)) return "manager"
  if (decomposable && highlyParallel) return "manager"
  return "direct_worker"
}

function buildReason(taskClass: Enums.TaskClass, routingProfile: Enums.RoutingProfile, score: number): string {
  return `task_class=${taskClass} routing_profile=${routingProfile} complexity_score=${score.toFixed(3)}`
}

/**
 * Classify a task deterministically from structured evaluation signals.
 * No model call, no I/O — a pure function of `inputs` and `thresholds`.
 */
export function classify(
  inputs: Decision.DecisionInputs,
  thresholds: ClassifierThresholds = DEFAULT_CLASSIFIER_THRESHOLDS,
): ClassificationResult {
  const signals = deriveSignals(inputs, thresholds)
  const complexityScore = compositeScore(signals)
  const taskClass = taskClassFromScore(complexityScore, thresholds.taskClassBoundaries)
  const routingProfile = routingProfileFromClass(taskClass, inputs, thresholds)

  return {
    taskClass,
    routingProfile,
    complexityScore,
    signals,
    reason: buildReason(taskClass, routingProfile, complexityScore),
  }
}
