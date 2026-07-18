// DDD role: ValueObject
// Package: langlock.policy
// Cohesive sub-objects composed by the LangLockPolicy aggregate root (FR5, FR7).
// Each stays within the calisthenics field bound; mutations are atomic and
// idempotent within the Config.Service authority with version/CAS (FR5, C2).

package langlock.policy

import (
	"langlock/ids"
	"langlock/enums"
)

// PolicyIdentity carries the owning principal, CAS version and lifecycle timestamps (FR5, FR7).
#PolicyIdentity: {
	principal:  ids.#Principal
	version:    ids.#PolicyVersion
	created_at: ids.#Timestamp
	updated_at: ids.#Timestamp
}

// PolicyLanguage carries the enabled flag, canonical tag, display name and enforcement mode (FR1, FR7, FR16).
#PolicyLanguage: {
	enabled:          ids.#Enabled
	tag:              ids.#LanguageTag
	display_name:     ids.#DisplayName
	enforcement_mode: enums.#EnforcementMode
}

// PolicyAuthority carries scope, origin, floor, override and the bound project/manifest refs (FR5, C2, C16).
#PolicyAuthority: {
	scope:               enums.#Scope
	origin:              enums.#Origin
	hard_floor:          ids.#HardFloor
	override_authorized: ids.#OverrideAuthorized
	project_ref:         ids.#ProjectRef | null
	manifest_ref:        ids.#ManifestRef | null
}
