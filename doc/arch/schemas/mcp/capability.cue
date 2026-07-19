// DDD role: ValueObject
// Package: mcp.capability
// NegotiatedCapabilities — the per-server capability set recorded at connect for operator
// query (mcp.server.capabilities) and runtime gating (FR7, FR8, C2). It is a ValueObject
// embedded in the McpConnection aggregate: a capability the server did not advertise is
// never exercised, and reconnect re-runs negotiation and emits
// mcp.server.capabilities_changed on a diff (C2). Experimental client capabilities stay
// off unless the matching per-server flag is enabled (FR8, C18). Recorded caps carry no
// content (FR56, C26).

package mcp.capability

import (
	"mcp/ids"
)

// ToolsCapability records the server tools capability and its listChanged advertisement (FR10, FR11, C4).
#ToolsCapability: {
	list_changed: ids.#Capable
}

// ResourcesCapability records the server resources subscribe and listChanged advertisements (FR21, FR22, C10).
#ResourcesCapability: {
	subscribe:    ids.#Capable
	list_changed: ids.#Capable
}

// PromptsCapability records the server prompts capability and its listChanged advertisement (FR27, C24).
#PromptsCapability: {
	list_changed: ids.#Capable
}

// LoggingCapability records the server logging capability and setLevel support (FR28, C23).
#LoggingCapability: {
	set_level: ids.#Capable
}

// ExperimentalCapability records negotiated experimental caps; each off unless flag-enabled (FR8, FR41, C18).
#ExperimentalCapability: {
	tasks:          ids.#Capable
	sampling:       ids.#Capable
	elicitation:    ids.#Capable
	content_stream: ids.#Capable
}

// NegotiatedCapabilities is the recorded per-server capability set; unadvertised caps never run (FR7, FR8, C2).
#NegotiatedCapabilities: {
	protocol_version: ids.#ProtocolVersion
	tools:            #ToolsCapability
	resources:        #ResourcesCapability
	prompts:          #PromptsCapability
	logging:          #LoggingCapability
	experimental:     #ExperimentalCapability
	recorded_at:      ids.#Timestamp
}
