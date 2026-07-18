export * as EventsAdvisory from "./events-advisory"

import { Events } from "./events"

// Live-view of the langlock.* vocabulary — the nine live enforcement/advisory
// members (C8). Live members omit the durable annotation — no sequence, no
// replay; injection, reapply, stamping, advisory detection and resolution events
// never gate the write (FR17, FR21, C4, C6). Advisory records are content-free:
// bounded enums/buckets only, no file text, diff, prompt, path or snippet
// (Security 5, AC14). The member Structs are authored in events.ts (the
// authoritative module); this module re-exports the live subset and provides a
// grouping array for the EventV2 bus layer (T021).

export const LangLockPolicyInjectedEvent = Events.LangLockPolicyInjectedEvent
export const LangLockPolicyReappliedEvent = Events.LangLockPolicyReappliedEvent
export const LangLockEnvelopeStampedEvent = Events.LangLockEnvelopeStampedEvent
export const LangLockAdvisoryFlaggedEvent = Events.LangLockAdvisoryFlaggedEvent
export const LangLockAdvisoryAcknowledgedEvent = Events.LangLockAdvisoryAcknowledgedEvent
export const LangLockAdvisorySuppressedEvent = Events.LangLockAdvisorySuppressedEvent
export const LangLockDetectorUnknownEvent = Events.LangLockDetectorUnknownEvent
export const LangLockResolutionRetainedEvent = Events.LangLockResolutionRetainedEvent
export const LangLockUnknownEvent = Events.LangLockUnknownEvent

// LiveMembers is the ordered set of all nine live member schemas. The bus layer
// maps each to its own EventV2.define Definition with no durable annotation (C8).
export const LiveMembers = [
  LangLockPolicyInjectedEvent,
  LangLockPolicyReappliedEvent,
  LangLockEnvelopeStampedEvent,
  LangLockAdvisoryFlaggedEvent,
  LangLockAdvisoryAcknowledgedEvent,
  LangLockAdvisorySuppressedEvent,
  LangLockDetectorUnknownEvent,
  LangLockResolutionRetainedEvent,
  LangLockUnknownEvent,
] as const
