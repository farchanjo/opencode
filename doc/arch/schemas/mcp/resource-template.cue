// DDD role: Entity
// Package: mcp.resources
// McpResourceTemplate — one RFC 6570 resource template reachable through the canonical
// adapter under mcp:server:* Permission (FR19, C10). Its identity is the template URI,
// scoped to the negotiated roots like a concrete resource; a file template is confined to
// authorized roots and every non-allowlisted scheme is deny-by-default (FR25, C12). It is
// runtime content under Permission, never a Feature 007 admin ID (FR19, C25). Sub-objects
// in resource-parts.cue.

package mcp.resources

import (
	"mcp/ids"
)

// McpResourceTemplate is one resource template; identity is its scoped template URI (FR19, C12).
#McpResourceTemplate: {
	id: ids.#ResourceTemplateUri

	// The server exposing this template (FR19, C10).
	server_ref: ids.#ServerId

	// The bounded human title of the template (FR57).
	title: ids.#Title

	// The MIME type gating decode-to-spool under the allowlist (FR36, C17).
	mime_type: ids.#MimeType | null

	// The project/session scope under a runtime PermissionRef (FR25, C10, C12).
	scope: #ResourceScope
}
