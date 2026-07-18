// DDD role: ValueObject
// Package: langlock.effective
// EffectiveConfig — the immutable read model surfaced to the LLM in the trusted
// execution envelope (FR7, C4). It carries no content and no administrative
// capability; the LLM reads it but never invokes admin commands (FR35, AC13).

package langlock.effective

import (
	"langlock/ids"
	"langlock/enums"
)

// EffectiveLanguage carries the enabled flag, canonical tag, display name and enforcement mode (FR7).
#EffectiveLanguage: {
	enabled:          ids.#Enabled
	tag:              ids.#LanguageTag
	display_name:     ids.#DisplayName
	enforcement_mode: enums.#EnforcementMode
}

// EffectiveAuthority carries the resolved scope, origin, policy version and override state (FR7, C2).
#EffectiveAuthority: {
	scope:               enums.#Scope
	origin:              enums.#Origin
	policy_version:      ids.#PolicyVersion
	override_authorized: ids.#OverrideAuthorized
}

// EffectiveConfig is the immutable, content-free effective policy read model (FR7, FR35, C4).
#EffectiveConfig: {
	language:  #EffectiveLanguage
	authority: #EffectiveAuthority
}
