// DDD role: ValueObject
// Package: mcp.enums
// Event-envelope enums for the Feature 008 mcp.* vocabulary — the durable/live class
// split, the event source, the actor kind, the visibility scope and the catalog kind a
// list_changed event refers to (FR38, C3, C26). Durable events persist for reindex and
// audit correlation; live events are coalesced and never required to persist (C3). No
// actor is the LLM — management is operator-only and runtime is under Permission (FR48,
// FR50, C25). Every enum is a ValueObject.

package mcp.enums

// EventClass splits durable control-plane events from coalesced live UI/OTEL events (FR38, C3).
#EventClass: "durable" | "live"

// EventSource is the bounded origin of an mcp.* event; never the LLM (FR48, C25).
#EventSource: "operator" | "runtime" | "server" | "reconnector"

// ActorKind is the actor on an mcp.* event; runtime or operator only, no LLM (FR48, FR50, C25).
#ActorKind: "runtime" | "operator"

// Visibility is the authorization scope carried on an mcp.* event (FR56, Privacy 3).
#Visibility: "project" | "global" | "session"

// CatalogKind is the catalog a list_changed refresh event refers to (FR11, FR22, C4).
#CatalogKind: "tools" | "resources" | "prompts"
