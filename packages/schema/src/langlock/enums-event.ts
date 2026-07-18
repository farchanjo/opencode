export * as EnumsEvent from "./enums-event"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/langlock/enums-event.cue (package langlock.enums)
// one-to-one for the event class, source and actor enums carried on the
// langlock.* event envelope (C8). Administration is native operator-only; no LLM
// ever administers (FR35, Security 4).

// EventClass separates durable (replayable audit) from live (advisory) langlock.* events (C8).
export const EventClass = Schema.Literals(["durable", "live"]).annotate({
  identifier: "LangLockEnums.EventClass",
})
export type EventClass = typeof EventClass.Type

// EventSource names the origin subsystem of a langlock.* event (C8).
export const EventSource = Schema.Literals(["resolver", "injector", "stamper", "detector", "operator"]).annotate({
  identifier: "LangLockEnums.EventSource",
})
export type EventSource = typeof EventSource.Type

// ActorKind names who acted to produce the event; no LLM ever administers (FR35, AC13).
export const ActorKind = Schema.Literals(["runtime", "operator"]).annotate({
  identifier: "LangLockEnums.ActorKind",
})
export type ActorKind = typeof ActorKind.Type

// AuditAction names the audited mutation a durable audit event records (FR34, Security 4).
export const AuditAction = Schema.Literals([
  "set",
  "reset",
  "override_grant",
  "override_deny",
  "exception_register",
  "exception_revoke",
]).annotate({ identifier: "LangLockEnums.AuditAction" })
export type AuditAction = typeof AuditAction.Type
