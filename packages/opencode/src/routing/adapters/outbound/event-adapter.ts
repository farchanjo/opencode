/**
 * EventV2 outbound adapter (Feature 001 — T027).
 *
 * Publishes the `Events.RoutingEvent` tagged union (routing.decision,
 * routing.fallback, hierarchy.dispatch, hierarchy.validation,
 * hierarchy.escalation, capability.mismatch, todo.initialized,
 * todo.completion_blocked — packages/schema/src/routing/events.ts) onto the
 * core EventV2 bus. These are non-durable, content-free notification/audit
 * events: the routing decision itself is durably persisted by the atomic
 * `routing-decision.ts` commit protocol (T020) and the Todo aggregate by
 * `todo-authority.ts` (T024) / `session/todo.ts` (T030) — EventV2 here only
 * feeds Feature 002's Event Bus / Process Table and other live observers.
 *
 * Bridges the real Effect `EventV2.Service` the same way `event-v2-live.ts`
 * bridges it for the operator audit projection: a `useEvents` runner supplied
 * by the composition root, so this adapter stays framework-light and is
 * directly testable with a fake in-memory service (no Effect Layer graph).
 *
 * T031 registers these `Event.Definition`s into the app-wide
 * `event-manifest.ts` inventory and wires domain-event production into
 * `event-v2-bridge.ts`; this adapter only owns the publish boundary.
 */
export * as EventAdapter from "./event-adapter"

import type { Effect } from "effect"
import { Schema } from "effect"
import { define, inventory, type Definition } from "@opencode-ai/schema/event"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Budget } from "@opencode-ai/schema/routing/budget"
import { Enums } from "@opencode-ai/schema/routing/enums"
import { Events } from "@opencode-ai/schema/routing/events"
import { Ids } from "@opencode-ai/schema/routing/ids"

// =============================================================================
// Event.Definitions — one per RoutingEvent union member, non-durable
// =============================================================================

export const RoutingDecisionDefinition = define({
  type: "routing.decision",
  schema: {
    correlation: Events.DecisionCorrelation,
    classification: Events.EventClassification,
    selection: Events.EventSelection,
    hierarchy_role: Enums.HierarchyRole,
    budget_snapshot: Budget.PolicySnapshot,
  },
})

export const RoutingFallbackDefinition = define({
  type: "routing.fallback",
  schema: {
    decision_id: Ids.DecisionId,
    reason: Ids.Reason,
    execution_boundary: Enums.ExecutionBoundary,
    candidate_selected: Ids.ModelId,
  },
})

export const HierarchyDispatchDefinition = define({
  type: "hierarchy.dispatch",
  schema: {
    lineage: Events.DispatchLineage,
    fanout: Events.DispatchFanout,
    todo: Events.TodoPointer,
  },
})

export const HierarchyValidationDefinition = define({
  type: "hierarchy.validation",
  schema: {
    session_id: Ids.SessionId,
    role: Enums.HierarchyRole,
    outcome: Events.ValidationOutcome,
    validation_reason: Ids.Reason,
  },
})

export const HierarchyEscalationDefinition = define({
  type: "hierarchy.escalation",
  schema: {
    worker_session_id: Ids.SessionId,
    reason: Ids.Reason,
    evidence_refs: Events.EvidenceRefs,
    reclassified_to: Schema.Literal("manager"),
  },
})

export const CapabilityMismatchDefinition = define({
  type: "capability.mismatch",
  schema: {
    provider: Ids.ProviderName,
    model: Ids.ModelId,
    dimension: Ids.CapabilityDimension,
    requirement: Ids.Requirement,
    outcome: Ids.Reason,
  },
})

export const TodoInitializedDefinition = define({
  type: "todo.initialized",
  schema: {
    session_id: Ids.SessionId,
    todo_ref: Ids.TodoRef,
    todo_version: Ids.TodoVersion,
    item_count: NonNegativeInt,
  },
})

export const TodoCompletionBlockedDefinition = define({
  type: "todo.completion_blocked",
  schema: {
    session_id: Ids.SessionId,
    reason: Ids.Reason,
    pending_items: NonNegativeInt,
  },
})

export const RoutingEventDefinitions = inventory(
  RoutingDecisionDefinition,
  RoutingFallbackDefinition,
  HierarchyDispatchDefinition,
  HierarchyValidationDefinition,
  HierarchyEscalationDefinition,
  CapabilityMismatchDefinition,
  TodoInitializedDefinition,
  TodoCompletionBlockedDefinition,
)

const DEFINITION_BY_TYPE: ReadonlyMap<Events.RoutingEvent["type"], Definition> = new Map(
  RoutingEventDefinitions.map((definition) => [definition.type as Events.RoutingEvent["type"], definition]),
)

// =============================================================================
// Publish port
// =============================================================================

export type RoutingEventPublishResult =
  | { readonly ok: true; readonly id: string; readonly type: Events.RoutingEvent["type"] }
  | { readonly ok: false; readonly reason: string }

export interface RoutingEventPort {
  readonly publish: (event: Events.RoutingEvent) => Promise<RoutingEventPublishResult>
}

// Minimal read boundary consumed from EventV2.Service.publish.
export interface RoutingEventV2ServiceLike {
  readonly publish: <D extends Definition>(
    definition: D,
    data: Record<string, unknown>,
    options?: { readonly id?: string },
  ) => Effect.Effect<{ readonly id: string; readonly type: string; readonly data: unknown }>
}

export function createEventAdapter(deps: {
  readonly useEvents: <A>(fn: (svc: RoutingEventV2ServiceLike) => Effect.Effect<A>) => Promise<A>
}): RoutingEventPort {
  return {
    async publish(event) {
      const definition = DEFINITION_BY_TYPE.get(event.type)
      if (!definition) return { ok: false, reason: `unknown routing event type: ${event.type}` }
      const { type: _type, ...data } = event
      try {
        const published = await deps.useEvents((events) => events.publish(definition, data))
        return { ok: true, id: published.id, type: event.type }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "EventV2 publish failed" }
      }
    },
  }
}
