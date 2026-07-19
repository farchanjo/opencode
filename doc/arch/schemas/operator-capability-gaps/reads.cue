// DDD role: ValueObject
// Package: operator_capability_gaps.reads
// The MCP live-server read projection (Feature 017, GAP E). The composition root
// gains a liveServerPort reading MCP.Service.status()+clients() and projecting
// each server onto a content-free read model — the connection status and whether
// capabilities are present — while the SSOT-only fields (CAS version, auditId,
// trust profile, timestamps) stay absent and are NEVER fabricated (FR1, FR2). No
// secret, raw token, header value, or filesystem path crosses this seam. CUE
// packages are not cross-resolved by the structural reader; import paths mirror
// the operator-persistence corpus style.

package operator_capability_gaps.reads

import (
	"operator-capability-gaps/enums"
	"operator-capability-gaps/shared"
	"operator-capability-gaps/flags"
)

// McpConnectionStatus is the faithful live connection enum from MCP.Service; a projection of the shipped Status union, never a token (FR1).
#McpConnectionStatus: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"

// LiveServerRead is one server's content-free projection over MCP.Service status()+clients(); SSOT-only fields stay absent, never fabricated (FR1, FR2).
#LiveServerRead: {
	serverId:            shared.#ServerId
	connection:          #McpConnectionStatus
	capabilitiesPresent: flags.#CapabilitiesPresent
}

// LiveServerReadList is the named collection of live-server projections carried on a read result; never an inline list (FR1).
#LiveServerReadList: [...#LiveServerRead]

// LiveServerReadResult is the guarded read outcome: the live projection, or the typed mcp_unavailable gap when the host is genuinely unbound (FR2).
#LiveServerReadResult: {
	readiness: enums.#BackendReadiness
	gap?:      enums.#ServiceGap
	reason?:   shared.#ReasonText
	servers:   #LiveServerReadList
}
