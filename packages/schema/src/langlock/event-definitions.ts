export * as EventDefinitions from "./event-definitions"

import type { Definition } from "../event"
import { Event } from "../event"
import { Correlation } from "./correlation"
import { EventsAdvisory } from "./events-advisory"
import { EventsAudit } from "./events-audit"

// Feature 004 / T014 — one `EventV2.define` Definition per langlock.* member
// (C8), mirroring the Feature 001/002/003 pattern (`dataFields(Member.fields)`,
// no raw tagged union wired to the bus).
//
// Defined at the SCHEMA layer (not `packages/core/src/langlock/event-bus.ts`)
// because the six durable audit members must be joinable into the canonical
// `Durable` inventory in `durable-event-manifest.ts` (T014), and the schema
// package can never depend on `packages/core` (core depends on schema, never the
// reverse). `event-bus.ts` (T021) re-exports these Definitions for the domain
// engine; there is exactly one copy of the wire shape per member (C8).
//
// Durable-aggregate wiring (C8): `packages/core/src/event.ts` reads the aggregate
// id from a TOP-LEVEL key on the published `data` object named by
// `durable.aggregate`. The content-free langlock.* envelope carries no policy or
// session id, so the per-aggregate `Ordering.sequence` groups by
// `Ordering.correlation_id`; every durable member's schema therefore carries an
// explicit top-level `correlation_id` field in addition to the nested
// `envelope`/`detail` payload, and the publish boundary (T022) projects
// `envelope.ordering.correlation_id` onto it (no duplicated authority).

function dataFields<T extends { readonly type: unknown }>(fields: T): Omit<T, "type"> {
  const { type: _drop, ...rest } = fields
  return rest
}

const DURABLE = { version: 1, aggregate: "correlation_id" } as const

// --- Durable audit members (six; C8) ------------------------------------------

export const PolicySetDefinition = Event.define({
  type: "langlock.policy_set",
  durable: DURABLE,
  schema: { ...dataFields(EventsAudit.LangLockPolicySetEvent.fields), correlation_id: Correlation.CorrelationId },
})
export const PolicyResetDefinition = Event.define({
  type: "langlock.policy_reset",
  durable: DURABLE,
  schema: { ...dataFields(EventsAudit.LangLockPolicyResetEvent.fields), correlation_id: Correlation.CorrelationId },
})
export const OverrideAuthorizedDefinition = Event.define({
  type: "langlock.override_authorized",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsAudit.LangLockOverrideAuthorizedEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const OverrideDeniedDefinition = Event.define({
  type: "langlock.override_denied",
  durable: DURABLE,
  schema: { ...dataFields(EventsAudit.LangLockOverrideDeniedEvent.fields), correlation_id: Correlation.CorrelationId },
})
export const ExceptionRegisteredDefinition = Event.define({
  type: "langlock.exception_registered",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsAudit.LangLockExceptionRegisteredEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const ExceptionRevokedDefinition = Event.define({
  type: "langlock.exception_revoked",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsAudit.LangLockExceptionRevokedEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})

/** The six durable audit member Definitions, in vocabulary order (C8). */
export const DurableDefinitions: ReadonlyArray<Definition> = [
  PolicySetDefinition,
  PolicyResetDefinition,
  OverrideAuthorizedDefinition,
  OverrideDeniedDefinition,
  ExceptionRegisteredDefinition,
  ExceptionRevokedDefinition,
]

// --- Live members (nine; C8) --------------------------------------------------

export const PolicyInjectedDefinition = Event.define({
  type: "langlock.policy_injected",
  schema: dataFields(EventsAdvisory.LangLockPolicyInjectedEvent.fields),
})
export const PolicyReappliedDefinition = Event.define({
  type: "langlock.policy_reapplied",
  schema: dataFields(EventsAdvisory.LangLockPolicyReappliedEvent.fields),
})
export const EnvelopeStampedDefinition = Event.define({
  type: "langlock.envelope_stamped",
  schema: dataFields(EventsAdvisory.LangLockEnvelopeStampedEvent.fields),
})
export const AdvisoryFlaggedDefinition = Event.define({
  type: "langlock.advisory_flagged",
  schema: dataFields(EventsAdvisory.LangLockAdvisoryFlaggedEvent.fields),
})
export const AdvisoryAcknowledgedDefinition = Event.define({
  type: "langlock.advisory_acknowledged",
  schema: dataFields(EventsAdvisory.LangLockAdvisoryAcknowledgedEvent.fields),
})
export const AdvisorySuppressedDefinition = Event.define({
  type: "langlock.advisory_suppressed",
  schema: dataFields(EventsAdvisory.LangLockAdvisorySuppressedEvent.fields),
})
export const DetectorUnknownDefinition = Event.define({
  type: "langlock.detector_unknown",
  schema: dataFields(EventsAdvisory.LangLockDetectorUnknownEvent.fields),
})
export const ResolutionRetainedDefinition = Event.define({
  type: "langlock.resolution_retained",
  schema: dataFields(EventsAdvisory.LangLockResolutionRetainedEvent.fields),
})
export const UnknownDefinition = Event.define({
  type: "langlock.unknown",
  schema: dataFields(EventsAdvisory.LangLockUnknownEvent.fields),
})

/** The nine live member Definitions, in vocabulary order (C8). */
export const LiveDefinitions: ReadonlyArray<Definition> = [
  PolicyInjectedDefinition,
  PolicyReappliedDefinition,
  EnvelopeStampedDefinition,
  AdvisoryFlaggedDefinition,
  AdvisoryAcknowledgedDefinition,
  AdvisorySuppressedDefinition,
  DetectorUnknownDefinition,
  ResolutionRetainedDefinition,
  UnknownDefinition,
]

/** All fifteen langlock.* member Definitions (durable then live). */
export const Definitions: ReadonlyArray<Definition> = [...DurableDefinitions, ...LiveDefinitions]

/** Definition lookup keyed by the bare (unversioned) `type` string. */
export const ByType: ReadonlyMap<string, Definition> = new Map(
  Definitions.map((definition) => [definition.type, definition]),
)
