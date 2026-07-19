// DDD role: ValueObject
// Package: mcp.events
// Durable server- and catalog-plane event members (FR38, C3). Server status, capabilities
// change, tools_changed and resources_changed persist to EventV2/EventBus for reindex and
// audit correlation and never carry content (FR38, FR56, C3, C26). The canonical id is
// mcp.tools_changed — a single spelling that FR38, the schema literal, and the Feature 009
// reindex trigger share (C3). A capabilities change is emitted only on a recorded-set diff
// after reconnect (C2). Details are cohesive sub-objects carried by their member.

package mcp.events

import (
	"mcp/ids"
	"mcp/enums"
)

// ServerStatusDetail carries the additive status and the typed capability gap (FR7, C2).
#ServerStatusDetail: {
	status: enums.#ServerStatus
	gap:    enums.#CapabilityGap
}

// CapabilitiesChangedDetail carries the negotiated protocol version and a bounded reason (FR7, C2).
#CapabilitiesChangedDetail: {
	protocol_version: ids.#ProtocolVersion
	reason:           ids.#Reason
}

// CatalogChangedDetail carries the catalog kind a list_changed refresh refers to (FR11, FR22, C4).
#CatalogChangedDetail: {
	kind: enums.#CatalogKind
}

// mcp.server.status — a server's additive status changed (FR38, C3).
#McpServerStatusEvent: {
	type:     "mcp.server.status"
	envelope: #McpEventEnvelope
	detail:   #ServerStatusDetail
}

// mcp.server.capabilities_changed — the recorded capability set differed on reconnect (FR38, C2).
#McpCapabilitiesChangedEvent: {
	type:     "mcp.server.capabilities_changed"
	envelope: #McpEventEnvelope
	detail:   #CapabilitiesChangedDetail
}

// mcp.tools_changed — the tool catalog was refreshed; single canonical spelling (FR38, C3).
#McpToolsChangedEvent: {
	type:     "mcp.tools_changed"
	envelope: #McpEventEnvelope
	detail:   #CatalogChangedDetail
}

// mcp.resources_changed — the resource catalog was refreshed under the permission model (FR22, C4).
#McpResourcesChangedEvent: {
	type:     "mcp.resources_changed"
	envelope: #McpEventEnvelope
	detail:   #CatalogChangedDetail
}
