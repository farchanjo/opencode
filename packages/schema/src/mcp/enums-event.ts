export * as EnumsEvent from "./enums-event"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/mcp/enums-event.cue (package mcp.enums) one-to-one for the
// event-envelope enums carried on the mcp.* vocabulary — the durable/live class
// split, the event source, the actor kind, the visibility scope and the catalog kind
// a list_changed event refers to (FR38, C3, C26). Durable events persist for reindex
// and audit correlation; live events are coalesced and never required to persist (C3).
// No actor is the LLM — management is operator-only and runtime is under Permission
// (FR48, FR50, C25). The closed mcp.* vocabulary lives in ./event-types. Every enum is
// a ValueObject.

// EventClass splits durable control-plane events from coalesced live UI/OTEL events (FR38, C3).
export const EventClass = Schema.Literals(["durable", "live"]).annotate({ identifier: "McpEnums.EventClass" })
export type EventClass = typeof EventClass.Type

// EventSource is the bounded origin of an mcp.* event; never the LLM (FR48, C25).
export const EventSource = Schema.Literals(["operator", "runtime", "server", "reconnector"]).annotate({
  identifier: "McpEnums.EventSource",
})
export type EventSource = typeof EventSource.Type

// ActorKind is the actor on an mcp.* event; runtime or operator only, no LLM (FR48, FR50, C25).
export const ActorKind = Schema.Literals(["runtime", "operator"]).annotate({ identifier: "McpEnums.ActorKind" })
export type ActorKind = typeof ActorKind.Type

// Visibility is the authorization scope carried on an mcp.* event (FR56, Privacy 3).
export const Visibility = Schema.Literals(["project", "global", "session"]).annotate({
  identifier: "McpEnums.Visibility",
})
export type Visibility = typeof Visibility.Type

// CatalogKind is the catalog a list_changed refresh event refers to (FR11, FR22, C4).
export const CatalogKind = Schema.Literals(["tools", "resources", "prompts"]).annotate({
  identifier: "McpEnums.CatalogKind",
})
export type CatalogKind = typeof CatalogKind.Type
