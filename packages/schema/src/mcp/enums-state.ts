export * as EnumsState from "./enums-state"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/mcp/enums-state.cue (package mcp.enums) one-to-one for the
// lifecycle and state-machine enums — the authoritative server status union, the
// connection lifecycle machine and its terminal branches, the tool-catalog refresh
// machine, the resource-subscription machine, the experimental task status, the
// default resource-update policy ladder, and the typed call/cancel outcomes (FR7,
// FR10, FR21, FR23, FR42, C2, C4, C9, C10, C18). The Status union extends only
// additively (C2, C27); degraded/unauthorized paths fail closed (C10). Every enum is
// a ValueObject (calisthenics).

// ServerStatus is the authoritative status union that extends only additively (FR7, C2, C27).
export const ServerStatus = Schema.Literals([
  "pending",
  "connecting",
  "connected",
  "disconnected",
  "failed",
  "disabled",
  "needs_auth",
  "needs_client_registration",
]).annotate({ identifier: "McpEnums.ServerStatus" })
export type ServerStatus = typeof ServerStatus.Type

// ConnectionState is the internal lifecycle machine before a terminal branch (FR7, C2).
export const ConnectionState = Schema.Literals([
  "configured",
  "connecting",
  "negotiating",
  "recording",
  "connected",
  "reconnecting",
]).annotate({ identifier: "McpEnums.ConnectionState" })
export type ConnectionState = typeof ConnectionState.Type

// TerminalBranch is the closed set of terminal lifecycle outcomes (FR7, C2).
export const TerminalBranch = Schema.Literals([
  "disabled",
  "failed",
  "needs_auth",
  "needs_client_registration",
]).annotate({ identifier: "McpEnums.TerminalBranch" })
export type TerminalBranch = typeof TerminalBranch.Type

// CatalogState is the tool-catalog refresh machine under the duplicate-cursor guard (FR10, C4).
export const CatalogState = Schema.Literals(["stale", "walking", "fresh", "guard_tripped"]).annotate({
  identifier: "McpEnums.CatalogState",
})
export type CatalogState = typeof CatalogState.Type

// SubscriptionState is the resource-subscription machine; fail_closed on lost authority (FR21, C10).
export const SubscriptionState = Schema.Literals([
  "unsubscribed",
  "subscribing",
  "subscribed",
  "unsubscribing",
  "fail_closed",
]).annotate({ identifier: "McpEnums.SubscriptionState" })
export type SubscriptionState = typeof SubscriptionState.Type

// TaskStatus is the experimental Tasks lifecycle status including input_required (FR42, C18, C20).
export const TaskStatus = Schema.Literals(["working", "input_required", "completed", "failed", "cancelled"]).annotate({
  identifier: "McpEnums.TaskStatus",
})
export type TaskStatus = typeof TaskStatus.Type

// ResourceUpdatePolicy is the per-server update ladder; notify_cache is the default (FR23, FR24, C9).
export const ResourceUpdatePolicy = Schema.Literals(["notify_cache", "conditional_reread", "reindex", "wake"]).annotate(
  { identifier: "McpEnums.ResourceUpdatePolicy" },
)
export type ResourceUpdatePolicy = typeof ResourceUpdatePolicy.Type

// CallOutcome distinguishes tool-execution isError from protocol error at settlement (FR12, C5).
export const CallOutcome = Schema.Literals(["completed", "tool_error", "protocol_error", "cancelled"]).annotate({
  identifier: "McpEnums.CallOutcome",
})
export type CallOutcome = typeof CallOutcome.Type

// CancelOutcome records local settlement vs unacknowledged remote cancel (FR17, C8).
export const CancelOutcome = Schema.Literals(["acknowledged", "cancel_requested", "unknown_remote"]).annotate({
  identifier: "McpEnums.CancelOutcome",
})
export type CancelOutcome = typeof CancelOutcome.Type
