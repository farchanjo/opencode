export * as DurableEventManifest from "./durable-event-manifest"

import { Event } from "./event"
import { SessionEvent } from "./session-event"
import { SessionV1 } from "./session-v1"
import { OperatorEvent } from "./operator-event"
import { EventDefinitions as LifecycleEventDefinitions } from "./lifecycle/event-definitions"
import { EventDefinitions as JobEventDefinitions } from "./jobs/event-definitions"
import { EventDefinitions as LangLockEventDefinitions } from "./langlock/event-definitions"

export const SessionDurable = {
  definitions: Event.durable(SessionEvent.DurableDefinitions),
  schema: SessionEvent.Durable,
} as const

/**
 * Canonical durable event inventory (Feature002 + Feature007 operator.audit).
 * Keys are versioned types: `${type}.${version}`.
 */
export const Durable = Event.durable([
  ...SessionV1.Event.Definitions.filter((definition) => definition.durable !== undefined),
  ...SessionEvent.DurableDefinitions,
  ...OperatorEvent.DurableDefinitions,
  // Feature 002 / T015: the eleven durable lifecycle members (C4, C5).
  ...LifecycleEventDefinitions.DurableDefinitions,
  // Feature 003 / T018: the twenty-three durable job.* members (C5, C8).
  ...JobEventDefinitions.DurableDefinitions,
  // Feature 004 / T014: the six durable langlock.* audit members (C8).
  ...LangLockEventDefinitions.DurableDefinitions,
])
