// DDD role: Entity
// Package: mcp.tools
// McpToolCatalogEntry — one entry in a server's tool catalog (FR10, C4). Its identity is
// the tool_name, stable across paginated refreshes; the cached defs[server] shape
// consumers read is preserved as the paginated walk supersedes the single-shot path (FR10,
// FR11, C4, C27). Its annotations are untrusted unless the server trust profile elevates
// them (FR13a, C6); a runtime registration colliding with a reserved mcp.* id fails closed
// with no silent rename (FR48, C25). Sub-objects in tool-parts.cue.

package mcp.tools

import (
	"mcp/ids"
	"mcp/enums"
)

// McpToolCatalogEntry is one tool-catalog entry; identity is its tool name (FR10, C4).
#McpToolCatalogEntry: {
	id: ids.#ToolName

	// The server whose catalog holds this entry (FR10, C4).
	server_ref: ids.#ServerId

	// The tool contract: title, validation mode and task-support mode (FR12, FR42, C5, C18).
	contract: #ToolContract

	// The untrusted annotation hints; ignored for gating unless elevated (FR13a, C6).
	annotations: #ToolAnnotations

	// The trust profile governing whether annotations inform hints/policy (FR13a, C6).
	trust_profile: enums.#TrustProfile
}
