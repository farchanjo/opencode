export * as EventsAudit from "./events-audit"

import { Events } from "./events"

// Durable-view of the langlock.* vocabulary — the six durable audit members
// (C8). Durable audit members carry the EventV2 durable {version, aggregate}
// annotation and replay through readAggregate; policy-mutation, override and
// exception events are never coalesced or dropped (FR34, C8). The member Structs
// are authored in events.ts (the authoritative module) to avoid an ESM circular
// initialization; this module re-exports the durable subset and provides a
// grouping array for the EventV2 bus layer (T014, T021). Administration is native
// operator-only via Feature 007; no LLM ever authors these (FR35, Security 4,
// AC13).

export const LangLockPolicySetEvent = Events.LangLockPolicySetEvent
export const LangLockPolicyResetEvent = Events.LangLockPolicyResetEvent
export const LangLockOverrideAuthorizedEvent = Events.LangLockOverrideAuthorizedEvent
export const LangLockOverrideDeniedEvent = Events.LangLockOverrideDeniedEvent
export const LangLockExceptionRegisteredEvent = Events.LangLockExceptionRegisteredEvent
export const LangLockExceptionRevokedEvent = Events.LangLockExceptionRevokedEvent

// DurableMembers is the ordered set of all six durable audit member schemas. The
// bus layer maps each to its own EventV2.define Definition carrying the durable
// annotation (C8).
export const DurableMembers = [
  LangLockPolicySetEvent,
  LangLockPolicyResetEvent,
  LangLockOverrideAuthorizedEvent,
  LangLockOverrideDeniedEvent,
  LangLockExceptionRegisteredEvent,
  LangLockExceptionRevokedEvent,
] as const
