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

    return Service.of({ ...events, publish, publishRoutingEvent })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2.node] })

export * as EventV2Bridge from "./event-v2-bridge"
