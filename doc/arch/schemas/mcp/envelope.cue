// DDD role: ValueObject
// Package: mcp.events
// McpEventEnvelope — the common content-free context bundle carried on every mcp.* event,
// plus the closed McpEvent tagged union (FR38, C3, C26). It is a ValueObject: the
// identifiable message is the mcp.* event member that carries it. It is content-free per
// ADR-0001 — bounded enums, opaque ids and redacted key/value metadata only, never a tool/
// resource body, URI-as-content, prompt, or filesystem path (FR38, FR56, C26). Ten durable
// members persist for reindex and audit correlation; five live members are coalesced and
// never required to persist (C3). Members live in events-server/resource/call/live/log.cue.

package mcp.events

import (
	"mcp/ids"
	"mcp/enums"
	"mcp/values"
)

// EventKind carries the event type, schema version, class, source, actor and visibility (FR38, C3).
#EventKind: {
	event_type:     enums.#McpEventType
	schema_version: values.#SchemaVersion
	event_class:    enums.#EventClass
	source:         enums.#EventSource
	actor_kind:     enums.#ActorKind
	visibility:     enums.#Visibility
}

// EventSubject carries server/connection/request/resource identity; no path is ever present (FR38, FR56).
#EventSubject: {
	server_id:     ids.#ServerId
	connection_id: ids.#ConnectionId | null
	request_id:    ids.#RequestId | null
	resource_uri:  ids.#ResourceUri | null
}

// Ordering carries per-aggregate sequence, correlation and causation (FR38, C3).
#Ordering: {
	sequence:       values.#Sequence
	correlation_id: ids.#CorrelationId
	causation_id:   ids.#CausationId | null
}

// RedactedMetadata is the bounded key/value metadata map; no secrets, content, or paths (FR56, C26).
#RedactedMetadata: {[string]: string}

// Delivery carries visibility, timestamp and redacted metadata (FR56, C26).
#Delivery: {
	visibility:        enums.#Visibility
	timestamp:         ids.#Timestamp
	redacted_metadata: #RedactedMetadata
}

// McpEventEnvelope carries typed identity, ordering and delivery context for one mcp.* event (FR38, C3).
#McpEventEnvelope: {
	event_id: ids.#EventId
	kind:     #EventKind
	subject:  #EventSubject
	ordering: #Ordering
	delivery: #Delivery
}

// McpEvent is the closed tagged union of every mcp.* event member (FR38, C3).
#McpEvent: (
	#McpServerStatusEvent |
	#McpCapabilitiesChangedEvent |
	#McpToolsChangedEvent |
	#McpResourcesChangedEvent |
	#McpResourceUpdatedEvent |
	#McpSubscriptionSubscribedEvent |
	#McpSubscriptionUnsubscribedEvent |
	#McpCallSettledEvent |
	#McpCallCancelledEvent |
	#McpTaskSettledEvent |
	#McpCallStartedEvent |
	#McpCallProgressEvent |
	#McpCallCancelRequestedEvent |
	#McpTaskStatusEvent |
	#McpLogEvent
)
