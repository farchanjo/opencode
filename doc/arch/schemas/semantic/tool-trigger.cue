// DDD role: ValueObject
// Package: semantic.index
// Feature 009 tool reindex trigger and coalescing ValueObjects (FR8, C11). Three triggers
// — ToolRegistry corpus change, the Feature 008 mcp.tools_changed event for one server,
// and a tool-relevant Config.Service change — coalesce per affected server/scope within a
// bounded window into one incremental content-hash upsert/tombstone pass, never a full
// rebuild (FR8, NFR2, C11). This tool trigger is independent from and parallel to the
// Feature 008 resource-index opt-in; tools and resources are distinct document kinds
// (C11). The server ref is present only for the mcp_tools_changed source; null otherwise.

package semantic.index

import (
	"semantic/ids"
	"semantic/enums"
)

// ToolReindexTrigger is one incremental reindex trigger scoped to a project and optional server (FR8, C11).
#ToolReindexTrigger: {
	source:     enums.#ToolTriggerSource
	project_id: ids.#ProjectId
	server_ref: ids.#McpServerRef | null
}

// ToolTriggerSet is the first-class collection of triggers coalesced within the bounded window (FR8, NFR2, C11).
#ToolTriggerSet: [...#ToolReindexTrigger]

// ToolReindexBatch is the coalesced reindex batch per affected server/scope; one pass per burst (FR8, NFR2, C11).
#ToolReindexBatch: {
	project_id: ids.#ProjectId
	server_ref: ids.#McpServerRef | null
	triggers:   #ToolTriggerSet
}
