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

// HierarchyDepth bounds the routing hierarchy (1-2; 2 = Architect -> Manager
// -> Worker, ADR-0002). Mirrors config.cue #RoutingEnforcement.hierarchy.max_depth.
const HierarchyDepth = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2 }))

// OrchestrationMode (Feature 048) selects the hierarchy orchestration behavior.
// `heuristic` (default) is the byte-identical shipped single-hop heuristic;
// `force_manager` is the opt-in always-on Architect -> Manager -> Worker three-tier
// flow. The field is OPTIONAL on the persisted config; an absent value resolves to
// `heuristic`, so every already-persisted config stays valid.
// Mirrors config.cue #RoutingEnforcement.hierarchy.orchestration_mode.
export const OrchestrationMode = Schema.Literals(["heuristic", "force_manager"]).annotate({
  identifier: "RoutingConfig.OrchestrationMode",
})
export type OrchestrationMode = typeof OrchestrationMode.Type

/** The safe default orchestration mode when the field is absent (FR1). */
export const DEFAULT_ORCHESTRATION_MODE: OrchestrationMode = "heuristic"

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
  }),
}).annotate({ identifier: "RoutingConfig.Enforcement" })

// RoutingConfig composes activation, model pools and enforcement limits.
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  activation: Activation,
  models: Models,
  enforcement: Enforcement,
}).annotate({ identifier: "RoutingConfig.Info" })
