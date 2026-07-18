// DDD role: ValueObject
// Package: outputspool.enums
// Core bounded enums for the Feature 005 content plane — channel kind, group state
// machine, action/quota scope, durability tier, admission fault, stable error code,
// cursor state, retention edge kind and legal-hold state (FR10, FR15, FR19, FR43,
// C2, C4, C14, C20). Event and envelope enums live in enums-event.cue and
// event-types.cue. Every enum is a ValueObject, never an Entity (calisthenics).

package outputspool.enums

// Channel is the closed typed-channel set every group supports (FR15).
#Channel: "assistant-text" | "reasoning" | "stdout" | "stderr" | "tool-result" | "error" | "artifact"

// GroupState is the closed channel-generation state machine (FR19, C20).
#GroupState: "open" | "sealing" | "sealed" | "aborted" | "corrupt" | "expired" | "unknown"

// ActionScope bounds an output action; authorization is re-evaluated per action (FR43, C7).
#ActionScope: "self" | "child" | "tree" | "session" | "project" | "operator-global"

// QuotaScope bounds a quota/backpressure descriptor (FR10, C3).
#QuotaScope: "global" | "root" | "session" | "process" | "channel"

// DurabilityTier selects the tiered fsync posture per channel class (FR8, C2).
#DurabilityTier: "durable" | "console" | "disposable"

// AdmissionFault is a first-class observable admission/fault state, never swallowed (FR10, C4).
#AdmissionFault: "none" | "enospc" | "fd_exhaustion" | "quota" | "permission" | "latency"

// ErrorCode is the stable content-free error code returned to a caller (Security error handling).
#ErrorCode: "not_found" | "denied" | "quota" | "enospc" | "corrupt" | "expired" | "invalid_cursor"

// CursorState is the opaque follow-cursor lifecycle (FR22, C14).
#CursorState: "active" | "invalidated" | "rejected"

// RetentionEdgeKind classifies one inbound reference edge that gates cleanup (FR28, C5).
#RetentionEdgeKind: "transcript" | "todo" | "handoff" | "notification" | "row_telemetry" | "lease"

// LegalHoldState gates privacy erasure and legal hold on a group (FR30, Privacy 1, C5).
#LegalHoldState: "none" | "hold" | "released"
