// DDD role: ValueObject
// Package: semantic.provider
// Cohesive sub-objects composed by the SemanticProviderProfile aggregate (FR28). The
// version counter changes on any endpoint/compatibility change, never on a secret
// rotation (FR31). Credentials hold only Feature 007 SecretPort refs, never inline
// secrets (FR35, C19); a local endpoint MAY be key-free (FR29, AC19). Transport keeps
// the SSRF/TLS posture and the local/offline residency profile (FR33, FR37, C4, C17).

package semantic.provider

import (
	"semantic/ids"
	"semantic/enums"
)

// ProviderVersion is the immutable version counter of a provider profile (FR31).
#ProviderVersion: uint & >=1

// ProviderIdentity carries the name, base URL and transport compatibility profile (FR28, FR29).
#ProviderIdentity: {
	name:      ids.#Name
	base_url:  ids.#BaseUrl
	transport: enums.#TransportProfile
}

// ProviderTransport carries the TLS policy, residency profile and local-insecure allowance (FR33, FR37, C4, C17).
#ProviderTransport: {
	tls_policy:       enums.#TlsPolicy
	residency:        enums.#ResidencyProfile
	insecure_allowed: ids.#InsecureAllowed
}

// ProviderCredentials carries an optional secret ref and secure header refs; never raw (FR35, C19).
#ProviderCredentials: {
	secret_ref: ids.#SecretRef | null
	headers:    ids.#HeaderRefSet
}

// ProviderAudit carries the enabled flag and created/updated/selected-by metadata (FR29, FR35).
#ProviderAudit: {
	enabled:     ids.#Enabled
	created_at:  ids.#Timestamp
	updated_at:  ids.#Timestamp
	selected_by: ids.#OperatorRef
}
