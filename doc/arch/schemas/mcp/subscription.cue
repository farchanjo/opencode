// DDD role: Entity
// Package: mcp.resources
// ResourceSubscription — one operator-granted resource subscription (FR21, C10). Its
// identity is the subscription_id; it requires the server resources.subscribe capability
// and operator mcp.resource.admin.subscribe, and the LLM never subscribes — an
// unauthorized subscribe/read/delivery fails closed with a typed error (FR21, C10). While
// subscribed, resources/updated coalesces/dedupes/debounces into a bounded queue and
// updates UI and cache under the notify-cache default without an automatic re-read,
// reindex, or wake (FR23, FR24, C9).

package mcp.resources

import (
	"mcp/ids"
	"mcp/enums"
)

// ResourceSubscription is one operator-granted subscription; identity is its subscription id (FR21, C10).
#ResourceSubscription: {
	id: ids.#SubscriptionId

	// The subscribed resource URI (FR21, C10).
	resource_uri: ids.#ResourceUri

	// The server holding the subscription (FR21, C10).
	server_ref: ids.#ServerId

	// The subscription-machine state; fail_closed on lost authority (FR21, C10).
	state: enums.#SubscriptionState

	// The operator that granted the subscription; never the LLM (FR21, C10, C25).
	granted_by: ids.#OperatorRef

	// The per-aggregate correlation key for coalesced updates (FR23, C9).
	correlation_id: ids.#CorrelationId
}
