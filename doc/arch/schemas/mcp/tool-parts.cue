// DDD role: ValueObject
// Package: mcp.tools
// Cohesive sub-objects composed by the McpToolCatalogEntry entity (FR10, FR12, FR13a,
// C4, C5, C6). The contract carries the tool title, its outputSchema-validation mode and
// task-support mode; the annotations carry the untrusted readOnly/destructive/idempotent/
// openWorld hints that are ignored for gating unless the server trust profile elevates
// them (FR13a, C6). A tool is delivered top-level and via code-mode by one canonical
// adapter; only presentation differs (FR13, C13). No sub-object inlines a schema body or
// content (FR34, C16).

package mcp.tools

import (
	"mcp/ids"
	"mcp/enums"
)

// ToolContract carries the tool title, validation mode and task-support mode (FR12, FR42, C5, C18).
#ToolContract: {
	title:              ids.#Title
	output_schema_mode: enums.#OutputSchemaMode
	task_support:       enums.#TaskSupport
}

// ToolAnnotations carries the untrusted annotation hints; ignored for gating unless elevated (FR13a, C6).
#ToolAnnotations: {
	read_only:   ids.#Hint
	destructive: ids.#Hint
	idempotent:  ids.#Hint
	open_world:  ids.#Hint
}
