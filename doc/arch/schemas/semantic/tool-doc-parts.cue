// DDD role: ValueObject
// Package: semantic.documents
// Cohesive sub-objects composed by the ToolDoc entity (FR6). The descriptor carries the
// sanitized display name, source, MCP server ref and description as ranking signals only
// — a malicious description never widens permission or execution authority (FR3, C15).
// The parameter projection is the only Feature-009-novel sub-object: it keeps parameter
// names, JSON-Schema types and descriptions ONLY, stripping default/example/const/format,
// paths and any free-form secret, bounded by a size cap with a truncation flag (FR7, C6,
// AC18). No field is a secret or a filesystem path (FR7).

package semantic.documents

import (
	"semantic/ids"
	"semantic/enums"
)

// ToolDescriptor carries the sanitized display name, source, MCP server ref and description (FR6, C6).
#ToolDescriptor: {
	name:        ids.#DisplayName
	source:      enums.#ToolSource
	server_ref:  ids.#McpServerRef | null
	description: ids.#Description
}

// ToolParameter carries one sanitized parameter name, JSON-Schema type and description only (FR7, C6, AC18).
#ToolParameter: {
	name:        ids.#Name
	type:        enums.#JsonSchemaType
	description: ids.#Description
}

// ToolParameterSet is the first-class collection of sanitized parameter projections (FR7, C6).
#ToolParameterSet: [...#ToolParameter]

// ToolParameterProjection is the bounded parameter-schema projection with a size-cap truncation flag (FR7, C6, AC18).
#ToolParameterProjection: {
	parameters: #ToolParameterSet
	truncated:  ids.#Truncated
}
