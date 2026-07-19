// DDD role: AggregateRoot
// Package: mcp.connection
// McpConnection — the Feature 008 aggregate of one server's live lifecycle (FR7, C2).
// Its id is the connection_id; it advances through the fixed sequence configure →
// connect → negotiate → record → connected with terminal branches disabled/failed/
// needs_auth/needs_client_registration, and the authoritative Status union extends only
// additively (C2, C27). It records the negotiated capability set (a capability the server
// did not advertise is never exercised) and the typed capability gap; mcp_unavailable
// never hard-fails the session (FR7, C1, C2). Parts in connection-parts.cue.

package mcp.connection

import (
	"mcp/ids"
	"mcp/enums"
	"mcp/capability"
)

// McpConnection is the aggregate root of one server lifecycle; id is its connection id (FR7, C2).
#McpConnection: {
	id: ids.#ConnectionId

	// The McpServerProfile this connection serves (FR7, C2).
	server_ref: ids.#ServerId

	// The authoritative additive status union (FR7, C2, C27).
	status: enums.#ServerStatus

	// The internal lifecycle state before a terminal branch (FR7, C2).
	state: enums.#ConnectionState

	// The recorded per-server negotiated capability set (FR7, FR8, C2).
	capabilities: capability.#NegotiatedCapabilities

	// The typed capability gap; mcp_unavailable never hard-fails (FR7, C1, C2).
	gap: enums.#CapabilityGap

	// The bounded reconnect posture and session resume (FR29, C14).
	reconnect: #ReconnectPosture
}
