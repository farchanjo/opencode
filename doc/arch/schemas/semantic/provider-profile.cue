// DDD role: AggregateRoot
// Package: semantic.provider
// SemanticProviderProfile — a Feature 006 SSOT aggregate for one OpenAI-compatible
// provider endpoint (FR28). Its id is the provider_profile_id; Feature 007 references
// this schema and exposes operator commands without redefining the field set (FR28).
// A profile embeds NO secret: credentials are Feature 007 SecretPort refs only (FR35,
// C19). Its base URL is parsed under the SSRF-safe policy (FR33, C17). Parts in
// provider-parts.cue.

package semantic.provider

import "semantic/ids"

// SemanticProviderProfile is the SSOT aggregate root of a provider endpoint; id is its profile id (FR28, C5).
#SemanticProviderProfile: {
	id: ids.#ProviderProfileId

	// Immutable version counter of the provider profile (FR31).
	version: #ProviderVersion

	// Name, base URL and transport compatibility profile (FR28, FR29).
	identity: #ProviderIdentity

	// TLS policy, residency posture and local-insecure allowance (FR33, FR37, C4, C17).
	transport: #ProviderTransport

	// Optional secret ref and secure header refs — never raw material (FR35, C19).
	credentials: #ProviderCredentials

	// Enabled flag and created/updated/selected-by audit metadata (FR29, FR35).
	audit: #ProviderAudit
}
