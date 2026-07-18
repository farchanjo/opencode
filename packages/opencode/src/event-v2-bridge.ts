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
import { TodoEvents } from "@opencode-ai/schema/lifecycle/todo-events"
import { Events as JobEvents } from "@opencode-ai/schema/jobs/events"
import { EventDefinitions as JobEventDefinitions } from "@opencode-ai/schema/jobs/event-definitions"
import { Events as LangLockEvents } from "@opencode-ai/schema/langlock/events"
import { EventDefinitions as LangLockEventDefinitions } from "@opencode-ai/schema/langlock/event-definitions"

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

// =============================================================================
// Feature 002 / T032 — session-owned `todo.*` EventV2 definitions
// =============================================================================
//
// The seven session-owned Todo lifecycle members (`@opencode-ai/schema/
// lifecycle/todo-events`, T011, FR58m, C23-C25) are DISTINCT from the Feature
// 001 `todo.initialized` / `todo.completion_blocked` events (which Feature 002
// consumes read-only above). They follow the flat Feature 001 todo event shape
// (`{ pointer, counts }`) rather than the 26-member lifecycle envelope union,
// and — like the Feature 001 todo members — carry NO durable annotation: the
// schema `TodoEvents` module never joins the durable-event-manifest, so every
// member is a LIVE signal, published without a committed sequence (C4). Each
// gets its own `EventV2.define` Definition reusing the schema owner's field
// shapes (`.fields`, minus the redundant `type` literal) so the wire shape can
// never drift from the schema.

const TodoUpdatedDefinition = EventV2.define({
  type: "todo.updated",
  schema: dataFields(TodoEvents.TodoUpdatedEvent.fields),
})
const TodoCompletedDefinition = EventV2.define({
  type: "todo.completed",
  schema: dataFields(TodoEvents.TodoCompletedEvent.fields),
})
const TodoFailedDefinition = EventV2.define({
  type: "todo.failed",
  schema: dataFields(TodoEvents.TodoFailedEvent.fields),
})
const TodoCancelledDefinition = EventV2.define({
  type: "todo.cancelled",
  schema: dataFields(TodoEvents.TodoCancelledEvent.fields),
})
const TodoStaleDefinition = EventV2.define({
  type: "todo.stale",
  schema: dataFields(TodoEvents.TodoStaleEvent.fields),
})
const TodoRehydratedDefinition = EventV2.define({
  type: "todo.rehydrated",
  schema: dataFields(TodoEvents.TodoRehydratedEvent.fields),
})
const TodoHandoffAttachedDefinition = EventV2.define({
  type: "todo.handoff_attached",
  schema: dataFields(TodoEvents.TodoHandoffAttachedEvent.fields),
})

/** Public Definitions for the Feature 002 session-owned `todo.*` members, keyed by `type`. */
export const TodoEventDefinitions = {
  "todo.updated": TodoUpdatedDefinition,
  "todo.completed": TodoCompletedDefinition,
  "todo.failed": TodoFailedDefinition,
  "todo.cancelled": TodoCancelledDefinition,
  "todo.stale": TodoStaleDefinition,
  "todo.rehydrated": TodoRehydratedDefinition,
  "todo.handoff_attached": TodoHandoffAttachedDefinition,
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

  /**
   * Feature 002 / T032 — bridge one `TodoEvents.TodoEvent` member (the closed
   * seven-member session-owned Todo vocabulary, `packages/schema/src/lifecycle/
   * todo-events.ts`, FR58m) onto the EventV2 bus through the location-aware
   * `publish` above, mirroring `publishLifecycleEvent`. Each member publishes
   * through its own live wire `Definition`; no raw tagged union is ever wired to
   * the bus (C2). These members carry no durable annotation (C4), so none commits
   * a sequence.
   */
  readonly publishTodoEvent: (
    event: TodoEvents.TodoEvent,
    options?: EventV2.PublishOptions,
  ) => Effect.Effect<EventV2.Payload>

  /**
   * Feature 003 / T018 — bridge one `JobEvents.JobEvent` member (the closed
   * 30-member `job.*` vocabulary, `packages/schema/src/jobs/events.ts`, FR11)
   * onto the EventV2 bus through the location-aware `publish` above, mirroring
   * `publishLifecycleEvent`. Each member publishes through its own wire
   * `Definition` from `@opencode-ai/schema/jobs/event-definitions` (the single
   * canonical copy the durable manifest also joins, T018); no raw tagged union
   * is ever wired to the bus (C8). The twenty-three durable members (C8)
   * additionally carry a top-level `root_session_id`, projected from
   * `envelope.tree.root_session_id`, because `EventV2`'s durable-commit path
   * reads the aggregate id from a TOP-LEVEL data key (`durable.aggregate =
   * "root_session_id"`); the seven live members omit it and commit no sequence.
   * `job.*` is the Feature 003 lifecycle event namespace; the Feature 007
   * `jobs.*` operator command domain is distinct and this bridge never touches
   * it (C13).
   */
  readonly publishJobEvent: (
    event: JobEvents.JobEvent,
    options?: EventV2.PublishOptions,
  ) => Effect.Effect<EventV2.Payload>

  /**
   * Feature 004 / T022 — bridge one `LangLockEvents.LangLockEvent` member (the
   * closed 15-member `langlock.*` vocabulary, `packages/schema/src/langlock/
   * events.ts`, C8) onto the EventV2 bus through the location-aware `publish`
   * above, mirroring `publishJobEvent`. Each member publishes through its own wire
   * `Definition` from `@opencode-ai/schema/langlock/event-definitions` (the single
   * canonical copy the durable manifest also joins, T014); no raw tagged union is
   * ever wired to the bus (C8). The six durable audit members (C8) additionally
   * carry a top-level `correlation_id`, projected from
   * `envelope.ordering.correlation_id`, because `EventV2`'s durable-commit path
   * reads the aggregate id from a TOP-LEVEL data key (`durable.aggregate =
   * "correlation_id"`); the nine live members omit it and commit no sequence. The
   * `langlock.*` EventV2 audit/advisory prefix is distinct from the Feature 007
   * `langlock.*` operator command domain and this bridge never touches it (C3, C8).
   */
  readonly publishLangLockEvent: (
    event: LangLockEvents.LangLockEvent,
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

    // Feature 002 / T032 — one arm per session-owned Todo member (FR58m). All
    // seven are live (C4): none carries a durable annotation, so none commits a
    // sequence. The pointer/counts payload never carries objective/item/handoff
    // text (Feature 004 Lang Lock governs text; it is projected elsewhere).
    const publishTodoEvent: Interface["publishTodoEvent"] = (event, options) => {
      switch (event.type) {
        case "todo.updated": {
          const { type: _drop, ...data } = event
          return publish(TodoUpdatedDefinition, data, options)
        }
        case "todo.completed": {
          const { type: _drop, ...data } = event
          return publish(TodoCompletedDefinition, data, options)
        }
        case "todo.failed": {
          const { type: _drop, ...data } = event
          return publish(TodoFailedDefinition, data, options)
        }
        case "todo.cancelled": {
          const { type: _drop, ...data } = event
          return publish(TodoCancelledDefinition, data, options)
        }
        case "todo.stale": {
          const { type: _drop, ...data } = event
          return publish(TodoStaleDefinition, data, options)
        }
        case "todo.rehydrated": {
          const { type: _drop, ...data } = event
          return publish(TodoRehydratedDefinition, data, options)
        }
        case "todo.handoff_attached": {
          const { type: _drop, ...data } = event
          return publish(TodoHandoffAttachedDefinition, data, options)
        }
      }
    }

    // Feature 003 / T018 — one arm per job.* vocabulary member (FR11). Durable
    // members (C8) additionally carry a top-level `root_session_id`, projected
    // from `envelope.tree.root_session_id`, because `EventV2`'s durable-commit
    // path reads the aggregate id from a TOP-LEVEL data key (see
    // `@opencode-ai/schema/jobs/event-definitions` for the full rationale); live
    // members omit it. Definition-mutation, registration, occurrence-checkpoint,
    // overlap, execution-terminal, notification, and reconciliation events stay
    // distinct and are never collapsed (FR11, FR12).
    const publishJobEvent: Interface["publishJobEvent"] = (event, options) => {
      switch (event.type) {
        case "job.definition_created": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobDefinitionCreatedDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.definition_updated": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobDefinitionUpdatedDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.definition_enabled": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobDefinitionEnabledDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.definition_disabled": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobDefinitionDisabledDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.definition_deleted": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobDefinitionDeletedDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.registered": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobRegisteredDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.unregistered": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobUnregisteredDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.rescheduled": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobRescheduledDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.occurrence_claimed": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobOccurrenceClaimedDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.triggered": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobTriggeredDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.admitted": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobAdmittedDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.execution_started": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobExecutionStartedDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.execution_completed": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobExecutionCompletedDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.execution_failed": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobExecutionFailedDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.execution_cancelled": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobExecutionCancelledDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.execution_timed_out": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobExecutionTimedOutDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.overlap_rejected": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobOverlapRejectedDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.overlap_replaced": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobOverlapReplacedDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.notification_enqueued": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobNotificationEnqueuedDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.notification_acknowledged": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobNotificationAcknowledgedDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.notification_expired": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobNotificationExpiredDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.reconciled": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobReconciledDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.unknown": {
          const { type: _drop, ...rest } = event
          return publish(JobEventDefinitions.JobUnknownDefinition, { ...rest, root_session_id: event.envelope.tree.root_session_id }, options)
        }
        case "job.trigger_due": {
          const { type: _drop, ...data } = event
          return publish(JobEventDefinitions.JobTriggerDueDefinition, data, options)
        }
        case "job.misfired": {
          const { type: _drop, ...data } = event
          return publish(JobEventDefinitions.JobMisfiredDefinition, data, options)
        }
        case "job.skipped": {
          const { type: _drop, ...data } = event
          return publish(JobEventDefinitions.JobSkippedDefinition, data, options)
        }
        case "job.coalesced": {
          const { type: _drop, ...data } = event
          return publish(JobEventDefinitions.JobCoalescedDefinition, data, options)
        }
        case "job.queued": {
          const { type: _drop, ...data } = event
          return publish(JobEventDefinitions.JobQueuedDefinition, data, options)
        }
        case "job.notification_delivered": {
          const { type: _drop, ...data } = event
          return publish(JobEventDefinitions.JobNotificationDeliveredDefinition, data, options)
        }
        case "job.retry_scheduled": {
          const { type: _drop, ...data } = event
          return publish(JobEventDefinitions.JobRetryScheduledDefinition, data, options)
        }
      }
    }

    // Feature 004 / T022 — one arm per langlock.* vocabulary member (C8). The six
    // durable audit members additionally carry a top-level `correlation_id`,
    // projected from `envelope.ordering.correlation_id`, because `EventV2`'s
    // durable-commit path reads the aggregate id from a TOP-LEVEL data key (see
    // `@opencode-ai/schema/langlock/event-definitions` for the full rationale); the
    // nine live members omit it and commit no sequence. Policy-mutation, override,
    // exception, injection, advisory, and resolution events stay distinct and are
    // never collapsed (FR27, C8).
    const publishLangLockEvent: Interface["publishLangLockEvent"] = (event, options) => {
      switch (event.type) {
        case "langlock.policy_set": {
          const { type: _drop, ...rest } = event
          return publish(LangLockEventDefinitions.PolicySetDefinition, { ...rest, correlation_id: event.envelope.ordering.correlation_id }, options)
        }
        case "langlock.policy_reset": {
          const { type: _drop, ...rest } = event
          return publish(LangLockEventDefinitions.PolicyResetDefinition, { ...rest, correlation_id: event.envelope.ordering.correlation_id }, options)
        }
        case "langlock.override_authorized": {
          const { type: _drop, ...rest } = event
          return publish(LangLockEventDefinitions.OverrideAuthorizedDefinition, { ...rest, correlation_id: event.envelope.ordering.correlation_id }, options)
        }
        case "langlock.override_denied": {
          const { type: _drop, ...rest } = event
          return publish(LangLockEventDefinitions.OverrideDeniedDefinition, { ...rest, correlation_id: event.envelope.ordering.correlation_id }, options)
        }
        case "langlock.exception_registered": {
          const { type: _drop, ...rest } = event
          return publish(LangLockEventDefinitions.ExceptionRegisteredDefinition, { ...rest, correlation_id: event.envelope.ordering.correlation_id }, options)
        }
        case "langlock.exception_revoked": {
          const { type: _drop, ...rest } = event
          return publish(LangLockEventDefinitions.ExceptionRevokedDefinition, { ...rest, correlation_id: event.envelope.ordering.correlation_id }, options)
        }
        case "langlock.policy_injected": {
          const { type: _drop, ...data } = event
          return publish(LangLockEventDefinitions.PolicyInjectedDefinition, data, options)
        }
        case "langlock.policy_reapplied": {
          const { type: _drop, ...data } = event
          return publish(LangLockEventDefinitions.PolicyReappliedDefinition, data, options)
        }
        case "langlock.envelope_stamped": {
          const { type: _drop, ...data } = event
          return publish(LangLockEventDefinitions.EnvelopeStampedDefinition, data, options)
        }
        case "langlock.advisory_flagged": {
          const { type: _drop, ...data } = event
          return publish(LangLockEventDefinitions.AdvisoryFlaggedDefinition, data, options)
        }
        case "langlock.advisory_acknowledged": {
          const { type: _drop, ...data } = event
          return publish(LangLockEventDefinitions.AdvisoryAcknowledgedDefinition, data, options)
        }
        case "langlock.advisory_suppressed": {
          const { type: _drop, ...data } = event
          return publish(LangLockEventDefinitions.AdvisorySuppressedDefinition, data, options)
        }
        case "langlock.detector_unknown": {
          const { type: _drop, ...data } = event
          return publish(LangLockEventDefinitions.DetectorUnknownDefinition, data, options)
        }
        case "langlock.resolution_retained": {
          const { type: _drop, ...data } = event
          return publish(LangLockEventDefinitions.ResolutionRetainedDefinition, data, options)
        }
        case "langlock.unknown": {
          const { type: _drop, ...data } = event
          return publish(LangLockEventDefinitions.UnknownDefinition, data, options)
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

    return Service.of({ ...events, publish, publishRoutingEvent, publishLifecycleEvent, publishTodoEvent, publishJobEvent, publishLangLockEvent })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2.node] })

export * as EventV2Bridge from "./event-v2-bridge"
