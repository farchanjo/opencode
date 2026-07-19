// DDD role: ValueObject
// Package: semantic.shared
// Tool-scoped shared identity, reference and flag ValueObjects for the Feature 009
// `tools` collection projection. Centralised beside the Feature 006 shared VOs to avoid
// primitive obsession and duplicated constraints; the id/ref grouping is referenced via
// the `ids` alias like the other identity types (FR6, C6). A tool ref is a ranking
// pointer into live ToolRegistry/MCP/Permission state, revalidated after retrieval, never
// an embedded Entity (FR3, C11, C15). The MCP server ref is a Feature 008 catalog handle,
// null on native tools. No axis is a secret or a filesystem path (FR7, C6).

package semantic.shared

// ToolDocId is the canonical composed tool id keying one ToolDoc projection (FR6, C6).
#ToolDocId: string & =~"^[A-Za-z0-9_.:-]{1,192}$"

// ToolRef is a ranking pointer to a canonical tool revalidated against ToolRegistry/MCP/Permission (FR3, C11).
#ToolRef: string & =~"^[A-Za-z0-9_.:-]{1,192}$"

// McpServerRef references the Feature 008 MCP server owning a tool; null on native tools (FR6, C11).
#McpServerRef: string & =~"^[A-Za-z0-9_-]{1,128}$"

// Truncated flags whether the bounded parameter-schema projection was capped at the size limit (FR7, C6, AC18).
#Truncated: bool
