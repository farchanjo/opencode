// DDD role: ValueObject
// Package: semantic.documents
// Shared projection sub-objects composed by the AgentDoc, SkillDoc and SkillChunkDoc
// entities (FR10, FR11). A document is a derived, rebuildable projection — never a
// second store of record beside AgentV2/SkillV2/Catalog/Permission (FR1, FR2, C21).
// Identity carries the canonical version/content-hash/source driving incremental
// upsert/tombstone (FR13, AC10). Availability mirrors live core state and every
// candidate is revalidated before injection (FR20, C11). No field is a secret or path
// (FR17, C4).

package semantic.documents

import (
	"semantic/ids"
	"semantic/enums"
)

// DocIdentity carries the canonical version, content hash and source of a projection (FR10, FR11, FR13).
#DocIdentity: {
	version:      ids.#ConfigVersion
	content_hash: ids.#ContentHash
	source:       ids.#Tag
}

// DocScope carries the scalar project key, scope, visibility and permission ref filtered on every search (FR9, FR34, C6).
#DocScope: {
	project_id:     ids.#ProjectId
	scope:          enums.#ScopeKind
	visibility:     enums.#Visibility
	permission_ref: ids.#PermissionRef
}

// DocAvailability mirrors live enabled/available core state revalidated before injection (FR20, C11).
#DocAvailability: {
	enabled:   ids.#Enabled
	available: ids.#Available
}
