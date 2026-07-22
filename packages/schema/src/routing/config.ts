export * as RoutingConfig from "./config"

import { Schema } from "effect"
import { Budget } from "./budget"

// Shared enums (doc/arch/schemas/routing/enums.cue) re-exported cleanly for
// downstream routing schemas — TaskClass, RoutingProfile, TaskEffort,
// ReasoningEffort, ExecutionBoundary and HierarchyRole are canonically
// defined in ./enums and consumed by ./budget and later routing schemas.
export { TaskClass, RoutingProfile, TaskEffort, ReasoningEffort, ExecutionBoundary, HierarchyRole } from "./enums"

// RolePoolID identifies a named role pool (e.g. "architect", "manager",
// "worker-fast-large"). Resolved from Catalog.Service at routing time.
// Mirrors doc/arch/schemas/routing/config.cue #RolePoolID.
// Unbranded (plain non-empty string) to match the routing.shared primitive
// convention established in ./capability.ts pending a shared routing/ids.ts.
export const RolePoolID = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingConfig.RolePoolID",
})
export type RolePoolID = typeof RolePoolID.Type

// ModelId is a canonical model identifier resolved from ModelsDev.
// Mirrors doc/arch/schemas/routing/ids.cue #ModelId.
export const ModelId = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingConfig.ModelId",
})
export type ModelId = typeof ModelId.Type

// RoutingMode controls when Smart Routing is active.
export const RoutingMode = Schema.Literals(["always", "auto", "never"]).annotate({
  identifier: "RoutingConfig.Mode",
})
export type RoutingMode = typeof RoutingMode.Type

// MetadataSource controls where capability metadata is sourced.
export const MetadataSource = Schema.Literals(["catalog", "override", "observed"]).annotate({
  identifier: "RoutingConfig.MetadataSource",
})
export type MetadataSource = typeof MetadataSource.Type

// UnknownPolicy controls router behaviour when capability is unknown.
export const UnknownPolicy = Schema.Literals(["deny", "allow"]).annotate({
  identifier: "RoutingConfig.UnknownPolicy",
})
export type UnknownPolicy = typeof UnknownPolicy.Type

// SmartRoutingEnabled is the master enable flag for Smart Routing.
export const SmartRoutingEnabled = Schema.Boolean
export type SmartRoutingEnabled = typeof SmartRoutingEnabled.Type

// StrictGates, when true, makes hard gates authoritative over the decision model.
export const StrictGates = Schema.Boolean
export type StrictGates = typeof StrictGates.Type

// HierarchyDepth bounds the routing hierarchy after Feature 056 / ADR-0056:
// max 1 = main (architect) -> Worker only. Legacy persisted 2 MUST clamp at
// resolve if still present outside this schema. Mirrors config.cue.
const HierarchyDepth = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1 }))

// OrchestrationMode (Feature 048 literals; Feature 056 supersession): both
// values resolve to the collapsed main→Worker path — `force_manager` no longer
// creates a Manager child. Field remains OPTIONAL for dual-read of old configs.
// Mirrors config.cue #RoutingEnforcement.hierarchy.orchestration_mode.
export const OrchestrationMode = Schema.Literals(["heuristic", "force_manager"]).annotate({
  identifier: "RoutingConfig.OrchestrationMode",
})
export type OrchestrationMode = typeof OrchestrationMode.Type

/** The safe default orchestration mode when the field is absent (FR1). */
export const DEFAULT_ORCHESTRATION_MODE: OrchestrationMode = "heuristic"

// BoundAgentName (Feature 053) names an operator-configured role->agent binding on
// `Enforcement.hierarchy` (`manager_agent`/`data_agent`/`composer_agent`). It refers
// to an `Agent.Info.name` in the live registry — a plain non-empty string, never an
// enumerated set (the registry is config-composed at runtime). Mirrors
// deterministic-orchestration-handoff-role-to-agent-binding.cue `#BoundAgentName`.
export const BoundAgentName = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingConfig.BoundAgentName",
})
export type BoundAgentName = typeof BoundAgentName.Type

/** The safe default Data-stage agent when `hierarchy.data_agent` is absent (Feature
 * 053, FR1): the builtin read-only `explore` agent. `composer_agent` has no default. */
export const DEFAULT_DATA_AGENT = "explore"

/** Resolve the effective orchestration mode, collapsing an absent field to the
 * safe `heuristic` default so every persisted config is backward compatible. */
export function orchestrationModeOf(hierarchy: { readonly orchestration_mode?: OrchestrationMode }): OrchestrationMode {
  return hierarchy.orchestration_mode ?? DEFAULT_ORCHESTRATION_MODE
}

// RoutingActivation governs whether and when Smart Routing runs.
export interface Activation extends Schema.Schema.Type<typeof Activation> {}
export const Activation = Schema.Struct({
  enabled: SmartRoutingEnabled,
  mode: RoutingMode,
  strict_gates: StrictGates,
}).annotate({ identifier: "RoutingConfig.Activation" })

// RoutingModels configures decision-model and role-pool candidates.
export interface Models extends Schema.Schema.Type<typeof Models> {}
export const Models = Schema.Struct({
  decision_model: Schema.Struct({
    pool: Schema.Array(RolePoolID).check(Schema.isNonEmpty()),
  }),
  role_pools: Schema.Record(Schema.String, Schema.Array(ModelId)),
  fallback: Schema.Struct({
    floor_role: RolePoolID,
  }),
}).annotate({ identifier: "RoutingConfig.Models" })

// RoutingEnforcement configures capability, budget and hierarchy limits.
export interface Enforcement extends Schema.Schema.Type<typeof Enforcement> {}
export const Enforcement = Schema.Struct({
  capability: Schema.Struct({
    metadata_source: MetadataSource,
    unknown_policy: UnknownPolicy,
    probing_enabled: Schema.Boolean,
  }),
  budget: Budget.Policy,
  hierarchy: Schema.Struct({
    max_depth: HierarchyDepth,
    orchestration_only: Schema.Boolean,
    // Feature 048 — optional opt-in orchestration selector (default `heuristic`).
    orchestration_mode: Schema.optional(OrchestrationMode),
    // Feature 053 — optional role-to-agent bindings, mirroring the `orchestration_mode`
    // precedent above. All absent → byte-identical to Feature 048's shipped behavior (FR7).
    manager_agent: Schema.optional(BoundAgentName),
    data_agent: Schema.optional(BoundAgentName),
    composer_agent: Schema.optional(BoundAgentName),
  }),
}).annotate({ identifier: "RoutingConfig.Enforcement" })

// RoutingConfig composes activation, model pools and enforcement limits.
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  activation: Activation,
  models: Models,
  enforcement: Enforcement,
}).annotate({ identifier: "RoutingConfig.Info" })
