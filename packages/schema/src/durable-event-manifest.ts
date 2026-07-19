export * as DurableEventManifest from "./durable-event-manifest"

import { Event } from "./event"
import { SessionEvent } from "./session-event"
import { SessionV1 } from "./session-v1"
import { OperatorEvent } from "./operator-event"
import { EventDefinitions as LifecycleEventDefinitions } from "./lifecycle/event-definitions"
import { EventDefinitions as JobEventDefinitions } from "./jobs/event-definitions"
import { EventDefinitions as LangLockEventDefinitions } from "./langlock/event-definitions"
import { EventDefinitions as OutputSpoolEventDefinitions } from "./outputspool/event-definitions"
import { EventDefinitions as SemanticEventDefinitions } from "./semantic/event-definitions"
import { EventDefinitions as McpEventDefinitions } from "./mcp/event-definitions"

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
  // Feature 005 / T013: the seven durable output.* settlement members (C20).
  ...OutputSpoolEventDefinitions.DurableDefinitions,
  // Feature 006 / T013: the nine durable semantic.* settlement members (C22).
  ...SemanticEventDefinitions.DurableDefinitions,
  // Feature 008 / T009: the ten durable mcp.* control-plane members (C3).
  ...McpEventDefinitions.DurableDefinitions,
])
