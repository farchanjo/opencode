export * as Experimental from "./experimental"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/mcp/experimental.cue (package mcp.enums) one-to-one — the
// experimental-flag enums for the Feature 008 opt-in surfaces (FR41, FR45, C18). The
// flags mcp.tasks, mcp.sampling, mcp.elicitation and the nonstandard content-stream
// extension are separate, per-server, and disabled by default; the rollout order is
// tasks then sampling then elicitation then content-stream (C18). The content-stream
// extension advertises under one reserved namespaced capability string, never silently
// (FR6, C18). A flag set is a first-class collection of enabled flags. Every enum is a
// ValueObject.

// ExperimentalFlag is the closed per-server experimental-flag set, disabled by default (FR41, FR45, C18).
export const ExperimentalFlag = Schema.Literals(["tasks", "sampling", "elicitation", "content-stream"]).annotate({
  identifier: "McpEnums.ExperimentalFlag",
})
export type ExperimentalFlag = typeof ExperimentalFlag.Type

// FlagState is the enable posture of one experimental flag; disabled default (FR41, C18).
export const FlagState = Schema.Literals(["disabled", "enabled"]).annotate({ identifier: "McpEnums.FlagState" })
export type FlagState = typeof FlagState.Type

// ContentStreamCapability is the reserved namespaced capability string, never advertised silently (FR6, C18).
export const ContentStreamCapability = Schema.Literal("experimental/opencode.contentStream").annotate({
  identifier: "McpEnums.ContentStreamCapability",
})
export type ContentStreamCapability = typeof ContentStreamCapability.Type

// FlagSet is the first-class collection of enabled experimental flags on a server (FR45, C18).
export const FlagSet = Schema.Array(ExperimentalFlag).annotate({ identifier: "McpEnums.FlagSet" })
export type FlagSet = typeof FlagSet.Type
