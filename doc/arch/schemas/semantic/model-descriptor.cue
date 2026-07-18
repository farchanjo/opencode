// DDD role: AggregateRoot
// Package: semantic.model
// SemanticModelDescriptor — a Feature 006 SSOT aggregate for one embedding or rerank
// model at a provider (FR28). Its id is the canonical model ref; Feature 007
// references the schema without diverging the field set (FR28). A descriptor embeds
// NO secret (FR35, C19). Rerank capability is NEVER inferred from a model name; a
// manual descriptor is untrusted until native probe/eval passes (FR30, C16, AC22).
// Parts in model-parts.cue.

package semantic.model

import "semantic/ids"

// SemanticModelDescriptor is the SSOT aggregate root of a model; id is its canonical model ref (FR28, C3).
#SemanticModelDescriptor: {
	id: ids.#ModelDescriptorId

	// The provider profile this model is served by (FR28).
	provider_ref: ids.#ProviderRef

	// Display name, source and endpoint mode with any rerank profile (FR28, FR30).
	identity: #ModelIdentity

	// Validated capability kinds, dimension, metric and limits (FR30, C7, C16).
	capability: #ModelCapability

	// Probe/eval validation status, provenance and eval version (FR30, C16, AC22).
	validation: #ModelValidation

	// Whether the descriptor is enabled for selection in the operator panel (FR29).
	enabled: ids.#Enabled
}
