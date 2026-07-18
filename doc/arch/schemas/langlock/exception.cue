// DDD role: ValueObject
// Package: langlock.exception
// ExceptionEntry and ExceptionManifest — the operator-owned, schema-validated,
// allowlisted exemption records (FR14, C16, Security 2, Security 6). Untrusted
// LLM/plugin/prompt requests cannot create exemptions (Security 6, AC10). Exception
// use records bounded type, authority, scope and result without content (Security 6).

package langlock.exception

import (
	"langlock/ids"
	"langlock/enums"
)

// ExceptionAuthority carries the owning principal, scope and CAS version of an entry (FR14, C16).
#ExceptionAuthority: {
	principal: ids.#Principal
	scope:     enums.#Scope
	version:   ids.#PolicyVersion
}

// ExceptionEntry is one operator-owned exemption of a bounded category (FR14, C16, Security 6).
#ExceptionEntry: {
	id:         ids.#ExceptionId
	category:   enums.#ExceptionCategory
	authority:  #ExceptionAuthority
	reason:     ids.#Reason
	created_at: ids.#Timestamp
}

// ExceptionEntryList is the first-class collection of manifest entries (FR14, C16).
#ExceptionEntryList: [...#ExceptionEntry]

// ExceptionManifest is the operator-owned manifest bound to a policy (FR14, C16).
#ExceptionManifest: {
	manifest_ref: ids.#ManifestRef
	authority:    #ExceptionAuthority
	entries:      #ExceptionEntryList
	updated_at:   ids.#Timestamp
}
