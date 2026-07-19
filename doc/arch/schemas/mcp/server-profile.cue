// DDD role: AggregateRoot
// Package: mcp.server
// McpServerProfile — the Feature 008 SSOT aggregate of one configured MCP server (FR48,
// C2). Its id is the server_id; no LLM/ToolRegistry/MCP/custom/session.command path sets,
// updates, or deletes it — management is exclusively the operator-only Feature 007 mcp.*
// IDs (FR48, FR50, C25). Its auth carries Feature 007 SecretRefs only, never plaintext
// (FR32, C15); its trust profile is untrusted by default (FR13a, C6); its experimental
// flags are disabled by default (FR41, C18). Parts in server-parts.cue.

package mcp.server

import (
	"mcp/ids"
)

// McpServerProfile is the SSOT aggregate root of one MCP server; id is its server id (FR48, C2, C25).
#McpServerProfile: {
	id: ids.#ServerId

	// Server name and transport kind (FR29, FR48).
	identity: #ServerIdentity

	// Optional secret ref and secure header refs; never raw material (FR32, C15).
	auth: #ServerAuth

	// Trust profile, default update policy and outputSchema mode (FR13a, FR23, C5, C6, C9).
	policy: #ServerPolicy

	// Per-server experimental flag set, disabled by default (FR41, C18).
	experimental: #ServerExperimental

	// Enable posture, timestamps and the selecting operator (FR48, C25).
	audit: #ServerAudit
}
