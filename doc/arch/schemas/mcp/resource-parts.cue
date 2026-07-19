// DDD role: ValueObject
// Package: mcp.resources
// Cohesive sub-objects composed by the resource descriptors, subscription and update
// policy (FR23, FR25, C9, C12, C24). Scope confines a resource to its project/session
// roots under a runtime PermissionRef so no sibling-session or cross-project delivery is
// possible (FR25, Privacy 3, C12); provenance marks untrusted external content at the
// context boundary (FR27, C24); the update-policy rule carries the notify-cache default
// with re-read/reindex/wake opt-ins off by default (FR23, FR24, C9, C21, C22); coalescing
// carries the bounded-queue sequence and debounce (FR23, C9). No sub-object inlines
// content.

package mcp.resources

import (
	"mcp/ids"
	"mcp/enums"
	"mcp/values"
)

// ResourceScope confines a resource to its roots under a runtime PermissionRef (FR25, C10, C12).
#ResourceScope: {
	project_id:     ids.#ProjectId
	session_id:     ids.#SessionId | null
	permission_ref: ids.#PermissionRef
}

// ResourceProvenance marks untrusted external content at the context boundary (FR27, C24).
#ResourceProvenance: {
	provenance: enums.#ProvenanceClass
	label:      ids.#ProvenanceLabel
}

// UpdatePolicyRule carries the notify-cache default with off-by-default opt-ins (FR23, FR24, C9, C21, C22).
#UpdatePolicyRule: {
	policy:        enums.#ResourceUpdatePolicy
	reread_optin:  ids.#PolicyOptin
	reindex_optin: ids.#PolicyOptin
	wake_optin:    ids.#PolicyOptin
}

// UpdateCoalescing carries the bounded-queue sequence, debounce and coalesce flag (FR23, C9).
#UpdateCoalescing: {
	sequence:        values.#Sequence
	debounce_millis: values.#DurationMillis
	coalesced:       ids.#Coalesced
}
