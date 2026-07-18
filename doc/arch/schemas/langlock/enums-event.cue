// DDD role: ValueObject
// Package: langlock.enums
// Event class, source and actor enums carried on the langlock.* event envelope (C8).
// Administration is native operator-only; no LLM ever administers (FR35, Security 4).

package langlock.enums

// EventClass separates durable (replayable audit) from live (advisory) langlock.* events (C8).
#EventClass: "durable" | "live"

// EventSource names the origin subsystem of a langlock.* event (C8).
#EventSource: "resolver" | "injector" | "stamper" | "detector" | "operator"

// ActorKind names who acted to produce the event; no LLM ever administers (FR35, AC13).
#ActorKind: "runtime" | "operator"

// AuditAction names the audited mutation a durable audit event records (FR34, Security 4).
#AuditAction: "set" | "reset" | "override_grant" | "override_deny" | "exception_register" | "exception_revoke"
