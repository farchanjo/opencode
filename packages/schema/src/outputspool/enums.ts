export * as Enums from "./enums"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/outputspool/enums.cue (package outputspool.enums)
// one-to-one for the core channel/state/scope/fault closed enums (FR10, FR15,
// FR19, FR43, C2, C4, C14, C20). Event/actor enums live in ./enums-event; the
// closed output.* vocabulary lives in ./event-types. Every enum is a
// ValueObject, never an Entity (calisthenics).

// Channel is the closed typed-channel set every group supports (FR15).
export const Channel = Schema.Literals([
  "assistant-text",
  "reasoning",
  "stdout",
  "stderr",
  "tool-result",
  "error",
  "artifact",
]).annotate({ identifier: "OutputSpoolEnums.Channel" })
export type Channel = typeof Channel.Type

// GroupState is the closed channel-generation state machine (FR19, C20).
export const GroupState = Schema.Literals([
  "open",
  "sealing",
  "sealed",
  "aborted",
  "corrupt",
  "expired",
  "unknown",
]).annotate({ identifier: "OutputSpoolEnums.GroupState" })
export type GroupState = typeof GroupState.Type

// ActionScope bounds an output action; authorization is re-evaluated per action (FR43, C7).
export const ActionScope = Schema.Literals([
  "self",
  "child",
  "tree",
  "session",
  "project",
  "operator-global",
]).annotate({ identifier: "OutputSpoolEnums.ActionScope" })
export type ActionScope = typeof ActionScope.Type

// QuotaScope bounds a quota/backpressure descriptor (FR10, C3).
export const QuotaScope = Schema.Literals(["global", "root", "session", "process", "channel"]).annotate({
  identifier: "OutputSpoolEnums.QuotaScope",
})
export type QuotaScope = typeof QuotaScope.Type

// DurabilityTier selects the tiered fsync posture per channel class (FR8, C2).
export const DurabilityTier = Schema.Literals(["durable", "console", "disposable"]).annotate({
  identifier: "OutputSpoolEnums.DurabilityTier",
})
export type DurabilityTier = typeof DurabilityTier.Type

// AdmissionFault is a first-class observable admission/fault state, never swallowed (FR10, C4).
export const AdmissionFault = Schema.Literals([
  "none",
  "enospc",
  "fd_exhaustion",
  "quota",
  "permission",
  "latency",
]).annotate({ identifier: "OutputSpoolEnums.AdmissionFault" })
export type AdmissionFault = typeof AdmissionFault.Type

// ErrorCode is the stable content-free error code returned to a caller (Security error handling).
export const ErrorCode = Schema.Literals([
  "not_found",
  "denied",
  "quota",
  "enospc",
  "corrupt",
  "expired",
  "invalid_cursor",
]).annotate({ identifier: "OutputSpoolEnums.ErrorCode" })
export type ErrorCode = typeof ErrorCode.Type

// CursorState is the opaque follow-cursor lifecycle (FR22, C14).
export const CursorState = Schema.Literals(["active", "invalidated", "rejected"]).annotate({
  identifier: "OutputSpoolEnums.CursorState",
})
export type CursorState = typeof CursorState.Type

// RetentionEdgeKind classifies one inbound reference edge that gates cleanup (FR28, C5).
export const RetentionEdgeKind = Schema.Literals([
  "transcript",
  "todo",
  "handoff",
  "notification",
  "row_telemetry",
  "lease",
]).annotate({ identifier: "OutputSpoolEnums.RetentionEdgeKind" })
export type RetentionEdgeKind = typeof RetentionEdgeKind.Type

// LegalHoldState gates privacy erasure and legal hold on a group (FR30, Privacy 1, C5).
export const LegalHoldState = Schema.Literals(["none", "hold", "released"]).annotate({
  identifier: "OutputSpoolEnums.LegalHoldState",
})
export type LegalHoldState = typeof LegalHoldState.Type
