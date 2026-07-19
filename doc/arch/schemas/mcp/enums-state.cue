// DDD role: ValueObject
// Package: mcp.enums
// Lifecycle and state-machine enums for the Feature 008 MCP client — the authoritative
// server status union, the connection lifecycle machine and its terminal branches, the
// tool-catalog refresh machine, the resource-subscription machine, the experimental task
// status, the default resource-update policy ladder, and the typed call/cancel outcomes
// (FR7, FR10, FR21, FR23, FR42, C2, C4, C9, C10, C18). The Status union extends only
// additively (C2, C27); degraded/unauthorized paths fail closed (C10). Every enum is a
// ValueObject.

package mcp.enums

// ServerStatus is the authoritative status union that extends only additively (FR7, C2, C27).
#ServerStatus: "pending" | "connecting" | "connected" | "disconnected" | "failed" | "disabled" | "needs_auth" | "needs_client_registration"

// ConnectionState is the internal lifecycle machine before a terminal branch (FR7, C2).
#ConnectionState: "configured" | "connecting" | "negotiating" | "recording" | "connected" | "reconnecting"

// TerminalBranch is the closed set of terminal lifecycle outcomes (FR7, C2).
#TerminalBranch: "disabled" | "failed" | "needs_auth" | "needs_client_registration"

// CatalogState is the tool-catalog refresh machine under the duplicate-cursor guard (FR10, C4).
#CatalogState: "stale" | "walking" | "fresh" | "guard_tripped"

// SubscriptionState is the resource-subscription machine; fail_closed on lost authority (FR21, C10).
#SubscriptionState: "unsubscribed" | "subscribing" | "subscribed" | "unsubscribing" | "fail_closed"

// TaskStatus is the experimental Tasks lifecycle status including input_required (FR42, C18, C20).
#TaskStatus: "working" | "input_required" | "completed" | "failed" | "cancelled"

// ResourceUpdatePolicy is the per-server update ladder; notify_cache is the default (FR23, FR24, C9).
#ResourceUpdatePolicy: "notify_cache" | "conditional_reread" | "reindex" | "wake"

// CallOutcome distinguishes tool-execution isError from protocol error at settlement (FR12, C5).
#CallOutcome: "completed" | "tool_error" | "protocol_error" | "cancelled"

// CancelOutcome records local settlement vs unacknowledged remote cancel (FR17, C8).
#CancelOutcome: "acknowledged" | "cancel_requested" | "unknown_remote"
