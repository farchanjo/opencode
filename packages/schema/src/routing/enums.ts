export * as Enums from "./enums"

import { Schema } from "effect"

// TaskClass classifies task complexity before routing.
// Mirrors doc/arch/schemas/routing/enums.cue #TaskClass.
export const TaskClass = Schema.Literals(["small", "medium", "large", "complex"]).annotate({
  identifier: "Enums.TaskClass",
})
export type TaskClass = typeof TaskClass.Type

// RoutingProfile selects the hierarchy path.
// Mirrors doc/arch/schemas/routing/enums.cue #RoutingProfile.
export const RoutingProfile = Schema.Literals(["direct_worker", "manager"]).annotate({
  identifier: "Enums.RoutingProfile",
})
export type RoutingProfile = typeof RoutingProfile.Type

// TaskEffort rates expected resource consumption.
// Mirrors doc/arch/schemas/routing/enums.cue #TaskEffort.
export const TaskEffort = Schema.Literals(["minimal", "low", "medium", "high", "massive"]).annotate({
  identifier: "Enums.TaskEffort",
})
export type TaskEffort = typeof TaskEffort.Type

// ReasoningEffort rates expected reasoning complexity.
// Mirrors doc/arch/schemas/routing/enums.cue #ReasoningEffort.
export const ReasoningEffort = Schema.Literals(["minimal", "low", "medium", "high"]).annotate({
  identifier: "Enums.ReasoningEffort",
})
export type ReasoningEffort = typeof ReasoningEffort.Type

// ExecutionBoundary classifies failure modes for fallback decisions.
// Mirrors doc/arch/schemas/routing/enums.cue #ExecutionBoundary.
export const ExecutionBoundary = Schema.Literals(["safe", "retryable", "mutation_risky"]).annotate({
  identifier: "Enums.ExecutionBoundary",
})
export type ExecutionBoundary = typeof ExecutionBoundary.Type

// HierarchyRole names a role in the routing hierarchy.
// Mirrors doc/arch/schemas/routing/enums.cue #HierarchyRole.
export const HierarchyRole = Schema.Literals(["architect", "manager", "worker"]).annotate({
  identifier: "Enums.HierarchyRole",
})
export type HierarchyRole = typeof HierarchyRole.Type
