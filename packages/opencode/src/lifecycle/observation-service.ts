/**
 * Feature 002 / T026 (S10) — the typed observation service (`ObservationPort`).
 *
 * The read-only observation API over Effect `Stream`/`PubSub` with scoped
 * finalizers (C14, FR14–FR16): `observeSession`, `observeProcess`,
 * `observeTree`, and the privileged `observeGlobal(filter)`. Each method opens a
 * bounded subscription over the single EventV2 authority (the injected
 * `subscribe` seam wraps `EventBus.subscribeBounded`, C2/C10), applies the
 * canonical Permission/Policy authorization + redaction (T027) BEFORE delivery,
 * and returns a `Stream<LifecycleObservation>` whose finalizer unsubscribes with
 * no leak (AC5). No Observable ever controls lifecycle state or mutates a row
 * (FR17, FR18); a slow consumer can only lose live signals to the bounded
 * queue's overflow policy, never block a Task (AC7).
 *
 * Authorization is two-phase: the eager `authorizeScope` gate fails a
 * clearly-out-of-bounds request up front (`sibling_leak_rejected` for a sibling
 * Session or foreign tree, `unauthorized` for a non-operator global request,
 * AC3/AC4), and the per-event `authorizeEvent` filter drops any event outside
 * the principal's boundary and redacts the rest. The service holds no state and
 * makes zero model calls.
 */
export * as ObservationService from "./observation-service"

import { Effect, Stream } from "effect"
import type { Scope } from "effect"
import type { EventV2 } from "@opencode-ai/core/event"
import type { Enums } from "@opencode-ai/schema/lifecycle/enums"
import type { EnumsObservation } from "@opencode-ai/schema/lifecycle/enums-observation"
import type {
  GlobalObservationFilter,
  LifecycleObservation,
  ObservationError,
  ObserveGlobalInput,
  ObserveProcessInput,
  ObserveSessionInput,
  ObserveTreeInput,
  ObserverPrincipal,
} from "@opencode-ai/protocol/lifecycle/commands"
import type { ObservationPort } from "@opencode-ai/protocol/lifecycle/ports"
import { normalizeRecord, payloadDetail } from "./eventv2-adapter"
import { Authorization } from "./authorization"

/**
 * A scoped bounded lifecycle subscription. The composition root supplies this
 * from `EventBus.subscribeBounded(events, { capacity, overflow })`; keeping it a
 * seam lets the service be tested against an in-memory stream and enforces that
 * the finalizer (unsubscribe + queue shutdown) is owned by the caller's Scope
 * (C10, AC5).
 */
export type LifecycleSubscribe = Effect.Effect<Stream.Stream<EventV2.Payload>, never, Scope.Scope>

export interface ObservationServiceDeps {
  readonly subscribe: LifecycleSubscribe
}

type Predicate = (payload: EventV2.Payload) => boolean

/** Build one authorized, redacted, filtered observation stream (shared by every method). */
function authorizedStream(
  deps: ObservationServiceDeps,
  principal: ObserverPrincipal,
  match: Predicate,
): Effect.Effect<Stream.Stream<LifecycleObservation, never>, ObservationError, Scope.Scope> {
  const authorize = (payload: EventV2.Payload): LifecycleObservation | null => {
    const record = normalizeRecord(payload)
    const decision = Authorization.authorizeEvent(principal, record.envelope, payloadDetail(payload))
    if (!decision.allowed) return null
    return { envelope: decision.envelope, data: decision.detail, anomaly: null }
  }

  return Effect.map(deps.subscribe, (stream) =>
    stream.pipe(
      Stream.filter(match),
      Stream.map(authorize),
      Stream.filter((observation): observation is LifecycleObservation => observation !== null),
    ),
  )
}

/** Fail the effect when the eager scope gate denies the request (AC3/AC4). */
function gate(
  decision: Authorization.ScopeDecision,
): Effect.Effect<void, ObservationError> {
  return decision.authorized ? Effect.void : Effect.fail(decision.error)
}

export function createObservationService(deps: ObservationServiceDeps): ObservationPort {
  const observeSession = (input: ObserveSessionInput) =>
    Effect.gen(function* () {
      yield* gate(Authorization.authorizeScope(input.principal, "session", input.sessionId))
      return yield* authorizedStream(
        deps,
        input.principal,
        (payload) => envelopeOf(payload).tree.session_id === input.sessionId,
      )
    })

  const observeProcess = (input: ObserveProcessInput) =>
    Effect.gen(function* () {
      yield* gate(Authorization.authorizeScope(input.principal, "process", input.processId))
      return yield* authorizedStream(
        deps,
        input.principal,
        (payload) => envelopeOf(payload).process.process_id === input.processId,
      )
    })

  const observeTree = (input: ObserveTreeInput) =>
    Effect.gen(function* () {
      yield* gate(Authorization.authorizeScope(input.principal, "tree", input.rootSessionId))
      return yield* authorizedStream(
        deps,
        input.principal,
        (payload) => envelopeOf(payload).tree.root_session_id === input.rootSessionId,
      )
    })

  const observeGlobal = (input: ObserveGlobalInput) =>
    Effect.gen(function* () {
      yield* gate(Authorization.authorizeScope(input.principal, "global", null))
      const match = globalMatcher(input.filter)
      return yield* authorizedStream(deps, input.principal, match)
    })

  return { observeSession, observeProcess, observeTree, observeGlobal }
}

// =============================================================================
// Helpers
// =============================================================================

interface LifecyclePayloadData {
  readonly envelope: EnvelopeShape
}

interface EnvelopeShape {
  readonly kind: { readonly agent_kind: Enums.AgentKind }
  readonly tree: { readonly session_id: string; readonly root_session_id: string }
  readonly process: { readonly process_id: string }
  readonly hierarchy: { readonly role: EnumsObservation.HierarchyRole } | null
}

function envelopeOf(payload: EventV2.Payload): EnvelopeShape {
  return (payload.data as unknown as LifecyclePayloadData).envelope
}

/**
 * Bounded global filter: hierarchy role and agent kind project from the envelope
 * directly. Process state is not an envelope field (it is a Process Table
 * projection), so a `states` filter is applied by the operator layer over the
 * table, not here; leaving it unenforced keeps this stream a pure event filter.
 */
function globalMatcher(filter: GlobalObservationFilter): Predicate {
  const roles = filter.hierarchyRoles ? new Set<EnumsObservation.HierarchyRole>(filter.hierarchyRoles) : null
  const kinds = filter.agentKinds ? new Set<Enums.AgentKind>(filter.agentKinds) : null
  return (payload) => {
    const envelope = envelopeOf(payload)
    if (kinds !== null && !kinds.has(envelope.kind.agent_kind)) return false
    if (roles !== null && (envelope.hierarchy === null || !roles.has(envelope.hierarchy.role))) return false
    return true
  }
}

export type { ObservationError }
