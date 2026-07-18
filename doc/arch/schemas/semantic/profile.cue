// DDD role: ValueObject
// Package: semantic.profile
// TaskProfile and QueryFingerprint — the structured, content-free task representation
// driving retrieval (FR18). The original query text is preserved for embedding without
// a mandatory translation LLM call (FR15); the profile carries only bounded hints and
// a fingerprint, never the raw prompt (FR17, C4). The fingerprint keys the query
// embedding cache derived once per logical Task and reused across the agent and skill
// passes while valid (FR18, C10, AC16).

package semantic.profile

import (
	"semantic/ids"
	"semantic/enums"
	"semantic/values"
)

// QueryFingerprint keys the query-embedding cache by fingerprint, binding version and config hash (FR18, FR25, C10).
#QueryFingerprint: {
	fingerprint:     ids.#Fingerprint
	binding_version: values.#BindingVersion
	config_hash:     ids.#ConfigHash
}

// TaskProfile is the structured content-free task profile with bounded routing hints (FR18, C4).
#TaskProfile: {
	fingerprint: #QueryFingerprint
	role_hint:   enums.#RoleKind
	domains:     ids.#TagSet
	languages:   ids.#LanguageSet
	project_id:  ids.#ProjectId
}
