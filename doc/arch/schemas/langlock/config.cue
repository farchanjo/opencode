// DDD role: ValueObject
// Package: langlock.config
// The langlock.* Config.Service keys (FR5, FR7, C2). Lang Lock policy/config rides
// the canonical Feature 007 Config.Service authority that already merges global and
// project sources; no parallel store is introduced (C2). Global is the base
// authority; a project override applies only under langlock.override and never
// relaxes the global hard-policy floor (FR5, Security 1).

package langlock.config

import (
	"langlock/ids"
	"langlock/enums"
)

// ConfigLanguage carries the langlock.enabled / langlock.tag / langlock.enforcementMode keys (FR1, FR7, FR16).
#ConfigLanguage: {
	enabled:          ids.#Enabled
	tag:              ids.#LanguageTag
	enforcement_mode: enums.#EnforcementMode
}

// ConfigAuthority carries the langlock.scope / langlock.hardFloor / langlock.override / manifest keys (FR5, C2, C16).
#ConfigAuthority: {
	scope:               enums.#Scope
	hard_floor:          ids.#HardFloor
	override_authorized: ids.#OverrideAuthorized
	manifest_ref:        ids.#ManifestRef | null
}

// LangLockConfig is the merged langlock.* config document persisted in Config.Service (FR5, FR7, C2).
#LangLockConfig: {
	language:  #ConfigLanguage
	authority: #ConfigAuthority
	version:   ids.#ConfigVersion
}
