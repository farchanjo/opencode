export * as Ids from "./ids"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/mcp/ids.cue (package mcp.shared) one-to-one for the
// Feature 008 MCP client lifecycle and content-plane identity ValueObjects (FR7,
// FR10, FR21, FR27, FR38, FR48, C2, C3, C4, C8, C10, C24, C25).
//
// Name parity with lifecycle.shared / jobs.shared / outputspool.shared /
// semantic.shared is intentional — this feature does not cross-import those
// modules, so the identifier concepts are re-declared locally (FR7, FR48, C2, C25).
// No identity axis is a filesystem path (FR34, C16).
//
// ANNOTATION ORDER: every exported schema is annotated with its root identifier
// BEFORE any `.check(...)` is applied, and branded only after the check.
// Annotating an already-checked schema drops the root identifier from
// `.ast.annotations` in favor of annotating the last check instead, so
// base-then-check-then-brand is load-bearing for contract hygiene (see
// test/contract-hygiene.test.ts).

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const namePattern = /^[A-Za-z0-9_.:-]{1,160}$/
const eventIdPattern = /^evt_[A-Za-z0-9_-]{1,120}$/

// ServerId identifies one McpServerProfile aggregate — one configured MCP server (FR7, FR48, C2).
export const ServerId = Schema.String.annotate({ identifier: "McpIds.ServerId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Mcp.ServerId"))
export type ServerId = typeof ServerId.Type

// ConnectionId identifies one McpConnection aggregate — one live lifecycle attempt (FR7, C2).
export const ConnectionId = Schema.String.annotate({ identifier: "McpIds.ConnectionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Mcp.ConnectionId"))
export type ConnectionId = typeof ConnectionId.Type

// ToolName is the canonical tool token keying one McpToolCatalogEntry entity (FR10, C4).
export const ToolName = Schema.String.annotate({ identifier: "McpIds.ToolName" })
  .check(Schema.isPattern(namePattern))
  .pipe(Schema.brand("Mcp.ToolName"))
export type ToolName = typeof ToolName.Type

// PromptName is the canonical prompt token keying one McpPromptDescriptor entity (FR27, C24).
export const PromptName = Schema.String.annotate({ identifier: "McpIds.PromptName" })
  .check(Schema.isPattern(namePattern))
  .pipe(Schema.brand("Mcp.PromptName"))
export type PromptName = typeof PromptName.Type

// RequestId is the opaque JSON-RPC request id correlating a call to its settlement (FR2, FR17, C8).
export const RequestId = Schema.String.annotate({ identifier: "McpIds.RequestId" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Mcp.RequestId"))
export type RequestId = typeof RequestId.Type

// TaskId identifies one McpTask entity in the experimental Tasks lifecycle (FR41, C18).
export const TaskId = Schema.String.annotate({ identifier: "McpIds.TaskId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Mcp.TaskId"))
export type TaskId = typeof TaskId.Type

// ProgressToken is the opaque progress token supplied per call so servers emit progress (FR14, C7).
export const ProgressToken = Schema.String.annotate({ identifier: "McpIds.ProgressToken" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Mcp.ProgressToken"))
export type ProgressToken = typeof ProgressToken.Type

// SubscriptionId identifies one operator-granted ResourceSubscription entity (FR21, C10).
export const SubscriptionId = Schema.String.annotate({ identifier: "McpIds.SubscriptionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Mcp.SubscriptionId"))
export type SubscriptionId = typeof SubscriptionId.Type

// EventId is the EventV2 evt_ identifier assigned per published mcp.* event (FR38, C3).
export const EventId = Schema.String.annotate({ identifier: "McpIds.EventId" })
  .check(Schema.isPattern(eventIdPattern))
  .pipe(Schema.brand("Mcp.EventId"))
export type EventId = typeof EventId.Type
