// DDD role: ValueObject
// Package: mcp.server
// Cohesive sub-objects composed by the McpServerProfile aggregate (FR48, C2). Identity
// carries the server name and transport kind; auth holds Feature 007 SecretRefs and
// header refs only, never raw material (FR32, C15); policy carries the untrusted-by-
// default trust profile, the default resource-update policy and the tolerant outputSchema
// mode (FR13a, FR23, C5, C6, C9); experimental holds the per-server flag set, disabled by
// default (FR41, C18); audit records the operator principal and timestamps (FR48, C25).
// No sub-object inlines a secret or a path (FR32, FR34, C15, C16).

package mcp.server

import (
	"mcp/ids"
	"mcp/enums"
)

// ServerIdentity carries the server name and its transport kind (FR29, FR48).
#ServerIdentity: {
	name:      ids.#ServerName
	transport: enums.#TransportKind
}

// ServerAuth carries the optional secret ref and secure header refs; never raw material (FR32, C15).
#ServerAuth: {
	secret_ref: ids.#SecretRef | null
	headers:    ids.#HeaderRefSet
}

// ServerPolicy carries the trust profile, default update policy and outputSchema mode (FR13a, FR23, C5, C6, C9).
#ServerPolicy: {
	trust_profile:      enums.#TrustProfile
	update_policy:      enums.#ResourceUpdatePolicy
	output_schema_mode: enums.#OutputSchemaMode
}

// ServerExperimental carries the per-server experimental flag set, disabled by default (FR41, C18).
#ServerExperimental: {
	flags: enums.#FlagSet
}

// ServerAudit carries the enable posture, timestamps and the selecting operator (FR48, C25).
#ServerAudit: {
	enabled:     ids.#Enabled
	created_at:  ids.#Timestamp
	updated_at:  ids.#Timestamp
	selected_by: ids.#OperatorRef
}
