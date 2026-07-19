// DDD role: ValueObject
// Package: mcp.enums
// Experimental-flag enums for the Feature 008 opt-in surfaces (FR41, FR45, C18). The
// flags mcp.tasks, mcp.sampling, mcp.elicitation and the nonstandard content-stream
// extension are separate, per-server, and disabled by default; the rollout order is
// tasks then sampling then elicitation then content-stream (C18). The content-stream
// extension advertises under one reserved namespaced capability string, never silently
// (FR6, C18). A flag set is a first-class collection of enabled flags. Every enum is a
// ValueObject.

package mcp.enums

// ExperimentalFlag is the closed per-server experimental-flag set, disabled by default (FR41, FR45, C18).
#ExperimentalFlag: "tasks" | "sampling" | "elicitation" | "content-stream"

// FlagState is the enable posture of one experimental flag; disabled default (FR41, C18).
#FlagState: "disabled" | "enabled"

// ContentStreamCapability is the reserved namespaced capability string, never advertised silently (FR6, C18).
#ContentStreamCapability: "experimental/opencode.contentStream"

// FlagSet is the first-class collection of enabled experimental flags on a server (FR45, C18).
#FlagSet: [...#ExperimentalFlag]
