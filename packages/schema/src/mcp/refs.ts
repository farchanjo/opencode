export * as Refs from "./refs"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/mcp/refs.cue and correlation.cue (package mcp.shared)
// one-to-one. Cross-reference, secret, principal and correlation ValueObjects each
// carry an opaque handle only: a credential is a Feature 007 SecretPort secret ref,
// never raw material (FR32, C15); a content handle is a Feature 005 OutputRef, never
// a filesystem path (FR34, C16); a process ref points at a Feature 002 Process Table
// child, never an OS PID (FR39, C8). Project/session ids scope every resource URI and
// root so no sibling-session or cross-project delivery is possible (FR25, C12).
// Correlation and causation ids carry opaque trace linkage only; they live in traces
// and logs, never as metric labels (FR56, C26). No axis is a filesystem path.
//
// Same base-then-annotate-then-check-then-brand discipline as ./ids so the root
// identifier is retained for contract hygiene (see test/contract-hygiene.test.ts).

const idPattern = /^[A-Za-z0-9_-]{1,128}$/

// SecretRef is a Feature 007 SecretPort secure reference — never raw secret material (FR32, C15).
export const SecretRef = Schema.String.annotate({ identifier: "McpRefs.SecretRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Mcp.SecretRef"))
export type SecretRef = typeof SecretRef.Type

// HeaderRef is a secure reference to an outbound auth header value — never inline (FR32, C15).
export const HeaderRef = Schema.String.annotate({ identifier: "McpRefs.HeaderRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Mcp.HeaderRef"))
export type HeaderRef = typeof HeaderRef.Type

// OperatorRef is the operator principal that granted an action; re-evaluated per action (FR48, C25).
export const OperatorRef = Schema.String.annotate({ identifier: "McpRefs.OperatorRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Mcp.OperatorRef"))
export type OperatorRef = typeof OperatorRef.Type

// PermissionRef references the runtime PermissionV2 profile gating a call/read (FR50, C10).
export const PermissionRef = Schema.String.annotate({ identifier: "McpRefs.PermissionRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Mcp.PermissionRef"))
export type PermissionRef = typeof PermissionRef.Type

// OutputRef is a Feature 005 OutputSpool content handle for a spooled body — never a path (FR34, C16).
export const OutputRef = Schema.String.annotate({ identifier: "McpRefs.OutputRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Mcp.OutputRef"))
export type OutputRef = typeof OutputRef.Type

// GroupId references the Feature 005 OutputGroup created per call/read (FR33, C16).
export const GroupId = Schema.String.annotate({ identifier: "McpRefs.GroupId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Mcp.GroupId"))
export type GroupId = typeof GroupId.Type

// ProcessId references the Feature 002 Process Table child — never an OS PID (FR39, C8).
export const ProcessId = Schema.String.annotate({ identifier: "McpRefs.ProcessId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Mcp.ProcessId"))
export type ProcessId = typeof ProcessId.Type

// ProjectId is the project scope every resource URI and root is confined to (FR25, C12).
export const ProjectId = Schema.String.annotate({ identifier: "McpRefs.ProjectId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Mcp.ProjectId"))
export type ProjectId = typeof ProjectId.Type

// SessionId is the producing session scope; no sibling-session delivery is permitted (FR25, C12).
export const SessionId = Schema.String.annotate({ identifier: "McpRefs.SessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Mcp.SessionId"))
export type SessionId = typeof SessionId.Type

// CorrelationId is the per-aggregate correlation key for durable mcp.* ordering (FR38, C3).
export const CorrelationId = Schema.String.annotate({ identifier: "McpRefs.CorrelationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Mcp.CorrelationId"))
export type CorrelationId = typeof CorrelationId.Type

// CausationId links an mcp.* event to the event that caused it; trace linkage only (FR56, C26).
export const CausationId = Schema.String.annotate({ identifier: "McpRefs.CausationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Mcp.CausationId"))
export type CausationId = typeof CausationId.Type
