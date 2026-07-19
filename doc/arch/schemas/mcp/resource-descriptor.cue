// DDD role: Entity
// Package: mcp.resources
// McpResourceDescriptor — one runtime resource reachable through the canonical adapter
// under mcp:server:* Permission (FR19, C10). Its identity is the resource_uri, scoped to
// the negotiated roots; a file URI is confined to authorized project/session roots and
// every non-allowlisted scheme is deny-by-default (FR25, C12). It carries a subscription
// state but the LLM never subscribes — subscribe requires the server capability plus an
// operator grant (FR21, C10). It is runtime content, never a Feature 007 admin ID (FR19,
// C25). Sub-objects in resource-parts.cue.

package mcp.resources

import (
	"mcp/ids"
	"mcp/enums"
)

// McpResourceDescriptor is one runtime resource; identity is its scoped resource URI (FR19, C12).
#McpResourceDescriptor: {
	id: ids.#ResourceUri

	// The server exposing this resource (FR19, C10).
	server_ref: ids.#ServerId

	// The bounded human title of the resource (FR57).
	title: ids.#Title

	// The MIME type gating decode-to-spool under the allowlist (FR36, C17).
	mime_type: ids.#MimeType | null

	// The project/session scope under a runtime PermissionRef (FR25, C10, C12).
	scope: #ResourceScope

	// The untrusted-content provenance at the context boundary (FR27, C24).
	provenance: #ResourceProvenance

	// The subscription state; the LLM never subscribes (FR21, C10).
	subscription_state: enums.#SubscriptionState
}
