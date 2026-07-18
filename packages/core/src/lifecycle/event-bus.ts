export * as EventBus from "./event-bus"

import { Effect, Queue, Stream } from "effect"
import type { Scope } from "effect"
import type { Definition, Interface, Payload } from "../event"
import { EventDefinitions } from "@opencode-ai/schema/lifecycle/event-definitions"

// Feature 002 / T014 — the lifecycle EventV2 bus: one `EventV2.define`
// Definition per lifecycle member (FR20), registered at the schema layer
// (`@opencode-ai/schema/lifecycle/event-definitions`) rather than declared
// directly in this module, because the eleven durable members must also join
// the canonical `Durable` inventory in `packages/schema/src/
// durable-event-manifest.ts` (T015, C5) — and the schema package can never
// depend on `packages/core` (core depends on schema, never the reverse; see
// `packages/core/package.json`). This module re-exports the single canonical
// copy of those Definitions for the domain engine and the
// `EventV2Bridge.publishLifecycleEvent` boundary, so no raw `LifecycleEvent`
// tagged union is ever wired to the bus directly (C2, C4).

/** The eleven durable member Definitions, in vocabulary order (C4, C5). */
export const DurableDefinitions: ReadonlyArray<Definition> = EventDefinitions.DurableDefinitions

/** The fifteen live member Definitions, in vocabulary order (C4). */
export const LiveDefinitions: ReadonlyArray<Definition> = EventDefinitions.LiveDefinitions

/** All twenty-six lifecycle member Definitions (durable then live). */
export const Definitions: ReadonlyArray<Definition> = EventDefinitions.Definitions

/** Definition lookup keyed by the bare (unversioned) `type` string. */
export const ByType: ReadonlyMap<string, Definition> = EventDefinitions.ByType

// Re-export the individual Definitions under their own names for callers that
// want a statically-typed publish call (e.g. the bridge) instead of the
// dynamic `ByType` lookup.
export const {
  AdmittedDefinition,
  ParentAttachedDefinition,
  ProcessCreatedDefinition,
  StartedDefinition,
  HandoffDefinition,
  ReconciledDefinition,
  CompletedDefinition,
  FailedDefinition,
  CancelledDefinition,
  ZombieDetectedDefinition,
  OwnerLostDefinition,
  QueuedDefinition,
  WaitingDefinition,
  PromotedDefinition,
  ExtendedDefinition,
  TurnStartedDefinition,
  TurnEndedDefinition,
  TurnFailedDefinition,
  UnknownDefinition,
  SteerRequestedDefinition,
  SteerAcceptedDefinition,
  SteerRejectedDefinition,
  CancelRequestedDefinition,
  CancellingDefinition,
  ToolCalledDefinition,
  ToolSettledDefinition,
} = EventDefinitions

// =============================================================================
// Feature 002 / T014 (S5) — bounded subscription surface (C10)
// =============================================================================
//
// The Process Table and every observer subscribe to the lifecycle members over
// the single EventV2 authority via `EventV2.Service.listen` (C2). This seam wraps
// that listen in a bounded queue so a slow subscriber never blocks a Task,
// SessionRunner, or the producer hot path (C10, AC7). The bus itself is not a
// second event system and holds no unbounded universal PubSub.

/** The 26 registered lifecycle event type strings (bare, unversioned). */
export const LifecycleEventTypes: ReadonlyArray<string> = Object.freeze(Array.from(ByType.keys()))

const lifecycleTypeSet = new Set<string>(LifecycleEventTypes)

/**
 * Terminal, cancellation and tool-boundary events are priority and are never
 * dropped (C10, FR35–FR37). Their durable preservation is guaranteed by the
 * EventV2 durable aggregate (C5) and enforced by the projection layer; this
 * bounded seam only guarantees a slow subscriber never blocks the producer.
 */
export const PRIORITY_EVENT_TYPES: ReadonlyArray<string> = Object.freeze([
  "lifecycle.completed",
  "lifecycle.failed",
  "lifecycle.cancelled",
  "lifecycle.zombie_detected",
  "lifecycle.owner_lost",
  "lifecycle.cancel_requested",
  "lifecycle.cancelling",
  "lifecycle.tool_called",
  "lifecycle.tool_settled",
])

const prioritySet = new Set<string>(PRIORITY_EVENT_TYPES)

/** True when the payload is one of the 26 registered lifecycle members. */
export const isLifecycleEvent = (payload: Payload): boolean => lifecycleTypeSet.has(payload.type)

/** True when the payload is a priority (terminal/cancellation/tool-boundary) member. */
export const isPriorityEvent = (payload: Payload): boolean => prioritySet.has(payload.type)

/**
 * Bounded-queue overflow policy, reusing the Feature 001 posture (C10):
 * `backpressure` evicts the oldest buffered live signal to admit the newest;
 * `drop` rejects the incoming live signal. Neither ever blocks the producer.
 */
export type OverflowPolicy = "backpressure" | "drop"

export interface BoundedSubscriptionOptions {
  readonly capacity: number
  /** Defaults to `drop`. */
  readonly overflow?: OverflowPolicy
}

/**
 * Subscribe to the lifecycle members over `EventV2.Service.listen` (C2) behind a
 * bounded queue. Non-lifecycle events are filtered out before the queue. The
 * subscription is scoped: the returned Stream's finalizer unsubscribes the
 * listener and shuts the queue down, leaving no leak (C14, AC5). A slow consumer
 * of the returned Stream can only lose live signals to the overflow policy — it
 * can never apply backpressure to the producer (C10, AC7).
 */
export const subscribeBounded = (
  events: Interface,
  options: BoundedSubscriptionOptions,
): Effect.Effect<Stream.Stream<Payload>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const overflow = options.overflow ?? "drop"
    const queue = yield* (overflow === "backpressure"
      ? Queue.sliding<Payload>(options.capacity)
      : Queue.dropping<Payload>(options.capacity))
    const unsubscribe = yield* events.listen((event) =>
      lifecycleTypeSet.has(event.type) ? Queue.offer(queue, event).pipe(Effect.asVoid) : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe.pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid))
    return Stream.fromQueue(queue)
  })
