// Opencode publish boundary for core events. Attach routed instance location
// so direct EventV2 consumers can isolate directory/workspace streams.
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { GlobalBus } from "@/bus/global"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Context, Effect, Layer } from "effect"
import { Events } from "@opencode-ai/schema/routing/events"
import { EventBus as LifecycleEventBus } from "@opencode-ai/core/lifecycle/event-bus"
import { Events as LifecycleEvents } from "@opencode-ai/schema/lifecycle/events"

// =============================================================================
// Feature 001 / T031 — routing, hierarchy and capability EventV2 definitions
// =============================================================================
//
// `Events.RoutingEvent` (packages/schema/src/routing/events.ts, T006) is the
// closed tagged-union DATA shape shared with the persisted RoutingDecision
// record; it is not itself wired through `EventV2.define` (no `Definition`
// carries a raw union). Each member gets its own `EventV2.define` Definition
// here, reusing that module's field schemas (`.fields`, minus the redundant
// `type` literal) so the wire shape can never drift from the schema owner.

function dataFields<T extends { readonly type: unknown }>(fields: T): Omit<T, "type"> {
  const { type: _drop, ...rest } = fields
  return rest
}

const RoutingDecisionDefinition = EventV2.define({
  type: "routing.decision",
  schema: dataFields(Events.RoutingDecisionEvent.fields),
})
const RoutingFallbackDefinition = EventV2.define({
  type: "routing.fallback",
  schema: dataFields(Events.RoutingFallbackEvent.fields),
})
const HierarchyDispatchDefinition = EventV2.define({
  type: "hierarchy.dispatch",
  schema: dataFields(Events.HierarchyDispatchEvent.fields),
})
const HierarchyValidationDefinition = EventV2.define({
  type: "hierarchy.validation",
  schema: dataFields(Events.HierarchyValidationEvent.fields),
})
const HierarchyEscalationDefinition = EventV2.define({
  type: "hierarchy.escalation",
  schema: dataFields(Events.HierarchyEscalationEvent.fields),
})
const CapabilityMismatchDefinition = EventV2.define({
  type: "capability.mismatch",
  schema: dataFields(Events.CapabilityMismatchEvent.fields),
})
const TodoInitializedDefinition = EventV2.define({
  type: "todo.initialized",
  schema: dataFields(Events.TodoInitializedEvent.fields),
})
const TodoCompletionBlockedDefinition = EventV2.define({
  type: "todo.completion_blocked",
  schema: dataFields(Events.TodoCompletionBlockedEvent.fields),
})

/** Public Definitions for the Feature 001 routing/hierarchy/capability event members, keyed by `type`. */
export const RoutingEventDefinitions = {
  "routing.decision": RoutingDecisionDefinition,
  "routing.fallback": RoutingFallbackDefinition,
  "hierarchy.dispatch": HierarchyDispatchDefinition,
  "hierarchy.validation": HierarchyValidationDefinition,
  "hierarchy.escalation": HierarchyEscalationDefinition,
  "capability.mismatch": CapabilityMismatchDefinition,
  "todo.initialized": TodoInitializedDefinition,
  "todo.completion_blocked": TodoCompletionBlockedDefinition,
} as const

export interface Interface extends EventV2.Interface {
  /**
   * Feature 001 / T031 — bridge one `Events.RoutingEvent` member onto the
   * EventV2 bus through the location-aware `publish` below. The single entry
   * point for routing/hierarchy/capability/todo-authority events so every
   * caller (routing evaluator, hierarchy dispatcher, todo authority) shares
   * the same wire Definitions instead of hand-rolling `publish` calls.
   */
  readonly publishRoutingEvent: (
    event: Events.RoutingEvent,
    options?: EventV2.PublishOptions,
  ) => Effect.Effect<EventV2.Payload>

  /**
   * Feature 002 / T015 — bridge one `LifecycleEvents.LifecycleEvent` member
   * (the closed 26-member vocabulary, `packages/schema/src/lifecycle/
   * events.ts`, FR20) onto the EventV2 bus through the location-aware
   * `publish` above, mirroring `publishRoutingEvent`. Each member publishes
   * through its own wire `Definition` from `@opencode-ai/core/lifecycle/
   * event-bus` (T014); no raw tagged union is ever wired to the bus (C2).
   */
  readonly publishLifecycleEvent: (
    event: LifecycleEvents.LifecycleEvent,
    options?: EventV2.PublishOptions,
  ) => Effect.Effect<EventV2.Payload>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EventV2Bridge") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service

    const publish: EventV2.Interface["publish"] = (definition, data, options) =>
      Effect.gen(function* () {
        if (options?.location) return yield* events.publish(definition, data, options)
        const ctx = yield* InstanceRef
        if (!ctx) return yield* events.publish(definition, data, options)
        const workspaceID = yield* WorkspaceRef
        return yield* events.publish(definition, data, {
          ...options,
          location: new Location.Info({
            directory: AbsolutePath.make(ctx.directory),
            ...(workspaceID ? { workspaceID } : {}),
            project: { id: Project.ID.make(ctx.project.id), directory: AbsolutePath.make(ctx.worktree) },
          }),
        })
      })

    const publishRoutingEvent: Interface["publishRoutingEvent"] = (event, options) => {
      switch (event.type) {
        case "routing.decision": {
          const { type: _drop, ...data } = event
          return publish(RoutingDecisionDefinition, data, options)
        }
        case "routing.fallback": {
          const { type: _drop, ...data } = event
          return publish(RoutingFallbackDefinition, data, options)
        }
        case "hierarchy.dispatch": {
          const { type: _drop, ...data } = event
          return publish(HierarchyDispatchDefinition, data, options)
        }
        case "hierarchy.validation": {
          const { type: _drop, ...data } = event
          return publish(HierarchyValidationDefinition, data, options)
        }
        case "hierarchy.escalation": {
          const { type: _drop, ...data } = event
          return publish(HierarchyEscalationDefinition, data, options)
        }
        case "capability.mismatch": {
          const { type: _drop, ...data } = event
          return publish(CapabilityMismatchDefinition, data, options)
        }
        case "todo.initialized": {
          const { type: _drop, ...data } = event
          return publish(TodoInitializedDefinition, data, options)
        }
        case "todo.completion_blocked": {
          const { type: _drop, ...data } = event
          return publish(TodoCompletionBlockedDefinition, data, options)
        }
      }
    }

    // Feature 002 / T015 — one arm per lifecycle vocabulary member (FR20,
    // FR21). Durable members (C4, C5) additionally carry a top-level
    // `root_process_id`, projected from `envelope.process.root_process_id`,
    // because `EventV2`'s durable-commit path reads the aggregate id from a
    // TOP-LEVEL data key (see `@opencode-ai/schema/lifecycle/
    // event-definitions` for the full rationale); live members omit it.
    const publishLifecycleEvent: Interface["publishLifecycleEvent"] = (event, options) => {
      switch (event.type) {
        case "lifecycle.admitted": {
          const { type: _drop, ...rest } = event
          return publish(LifecycleEventBus.AdmittedDefinition, { ...rest, root_process_id: event.envelope.process.root_process_id }, options)
        }
        case "lifecycle.parent_attached": {
          const { type: _drop, ...rest } = event
          return publish(LifecycleEventBus.ParentAttachedDefinition, { ...rest, root_process_id: event.envelope.process.root_process_id }, options)
        }
        case "lifecycle.process_created": {
          const { type: _drop, ...rest } = event
          return publish(LifecycleEventBus.ProcessCreatedDefinition, { ...rest, root_process_id: event.envelope.process.root_process_id }, options)
        }
        case "lifecycle.started": {
          const { type: _drop, ...rest } = event
          return publish(LifecycleEventBus.StartedDefinition, { ...rest, root_process_id: event.envelope.process.root_process_id }, options)
        }
        case "lifecycle.handoff": {
          const { type: _drop, ...rest } = event
          return publish(LifecycleEventBus.HandoffDefinition, { ...rest, root_process_id: event.envelope.process.root_process_id }, options)
        }
        case "lifecycle.reconciled": {
          const { type: _drop, ...rest } = event
          return publish(LifecycleEventBus.ReconciledDefinition, { ...rest, root_process_id: event.envelope.process.root_process_id }, options)
        }
        case "lifecycle.completed": {
          const { type: _drop, ...rest } = event
          return publish(LifecycleEventBus.CompletedDefinition, { ...rest, root_process_id: event.envelope.process.root_process_id }, options)
        }
        case "lifecycle.failed": {
          const { type: _drop, ...rest } = event
          return publish(LifecycleEventBus.FailedDefinition, { ...rest, root_process_id: event.envelope.process.root_process_id }, options)
        }
        case "lifecycle.cancelled": {
          const { type: _drop, ...rest } = event
          return publish(LifecycleEventBus.CancelledDefinition, { ...rest, root_process_id: event.envelope.process.root_process_id }, options)
        }
        case "lifecycle.zombie_detected": {
          const { type: _drop, ...rest } = event
          return publish(LifecycleEventBus.ZombieDetectedDefinition, { ...rest, root_process_id: event.envelope.process.root_process_id }, options)
        }
        case "lifecycle.owner_lost": {
          const { type: _drop, ...rest } = event
          return publish(LifecycleEventBus.OwnerLostDefinition, { ...rest, root_process_id: event.envelope.process.root_process_id }, options)
        }
        case "lifecycle.queued": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.QueuedDefinition, data, options)
        }
        case "lifecycle.waiting": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.WaitingDefinition, data, options)
        }
        case "lifecycle.promoted": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.PromotedDefinition, data, options)
        }
        case "lifecycle.extended": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.ExtendedDefinition, data, options)
        }
        case "lifecycle.turn_started": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.TurnStartedDefinition, data, options)
        }
        case "lifecycle.turn_ended": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.TurnEndedDefinition, data, options)
        }
        case "lifecycle.turn_failed": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.TurnFailedDefinition, data, options)
        }
        case "lifecycle.unknown": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.UnknownDefinition, data, options)
        }
        case "lifecycle.steer_requested": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.SteerRequestedDefinition, data, options)
        }
        case "lifecycle.steer_accepted": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.SteerAcceptedDefinition, data, options)
        }
        case "lifecycle.steer_rejected": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.SteerRejectedDefinition, data, options)
        }
        case "lifecycle.cancel_requested": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.CancelRequestedDefinition, data, options)
        }
        case "lifecycle.cancelling": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.CancellingDefinition, data, options)
        }
        case "lifecycle.tool_called": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.ToolCalledDefinition, data, options)
        }
        case "lifecycle.tool_settled": {
          const { type: _drop, ...data } = event
          return publish(LifecycleEventBus.ToolSettledDefinition, data, options)
        }
      }
    }

    const unsubscribe = yield* events.listen((event) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceRef
        const workspaceID = (yield* WorkspaceRef) ?? event.location?.workspaceID
        GlobalBus.emit("event", {
          directory: event.location?.directory ?? ctx?.directory,
          project: ctx?.project.id,
          workspace: workspaceID,
          payload: { id: event.id, type: event.type, properties: event.data },
        })
        if (event.durable === undefined) return
        GlobalBus.emit("event", {
          directory: event.location?.directory ?? ctx?.directory,
          project: ctx?.project.id,
          workspace: workspaceID,
          payload: {
            type: "sync",
            syncEvent: {
              id: event.id,
              type: EventV2.versionedType(event.type, event.durable.version),
              seq: event.durable.seq,
              aggregateID: event.durable.aggregateID,
              data: event.data,
            },
          },
        })
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)

    return Service.of({ ...events, publish, publishRoutingEvent, publishLifecycleEvent })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2.node] })

export * as EventV2Bridge from "./event-v2-bridge"
