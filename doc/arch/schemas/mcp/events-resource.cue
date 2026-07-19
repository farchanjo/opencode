// DDD role: ValueObject
// Package: mcp.events
// Durable resource-plane event members (FR38, C3). A resource update and a subscription
// grant/revoke persist for reindex and audit correlation (FR38, C3). resources/updated is
// coalesced/deduped/debounced into a bounded queue and emits mcp.resource_updated with a
// per-aggregate sequence — notify and cache only, with no automatic re-read, reindex, or
// wake (FR23, FR24, C9). Subscribe/unsubscribe require the server capability plus an
// operator grant; the LLM never subscribes (FR21, C10). No member carries content or a
// path (FR38, FR56).

package mcp.events

import (
	"mcp/ids"
	"mcp/enums"
	"mcp/values"
)

// ResourceUpdatedDetail carries the updated resource URI and the coalesced sequence (FR23, C9).
#ResourceUpdatedDetail: {
	resource_uri: ids.#ResourceUri
	sequence:     values.#Sequence
}

// SubscriptionDetail carries the subscription id and its machine state (FR21, C10).
#SubscriptionDetail: {
	subscription_id: ids.#SubscriptionId
	state:           enums.#SubscriptionState
}

// mcp.resource_updated — a subscribed resource signalled an update under the notify-cache policy (FR23, C9).
#McpResourceUpdatedEvent: {
	type:     "mcp.resource_updated"
	envelope: #McpEventEnvelope
	detail:   #ResourceUpdatedDetail
}

// mcp.subscription.subscribed — an operator grant activated a subscription (FR21, C10).
#McpSubscriptionSubscribedEvent: {
	type:     "mcp.subscription.subscribed"
	envelope: #McpEventEnvelope
	detail:   #SubscriptionDetail
}

// mcp.subscription.unsubscribed — an operator unsubscribe released a subscription (FR21, C10).
#McpSubscriptionUnsubscribedEvent: {
	type:     "mcp.subscription.unsubscribed"
	envelope: #McpEventEnvelope
	detail:   #SubscriptionDetail
}
