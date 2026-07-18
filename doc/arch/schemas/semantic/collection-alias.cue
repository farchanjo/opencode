// DDD role: Entity
// Package: semantic.index
// CollectionAlias — one live alias mapping a conceptual collection (`agents`, `skills`,
// `skill_chunks`, or the Feature 009 `tools` extension) to a physical generation (FR9,
// FR12, C6, C21). It is an Entity: its id is the collection_alias_id with stable
// identity across cutovers. All aliases in a binding generation cut over together under
// one CAS so the `tools` collection never splits from the others (FR12, C12, C21).

package semantic.index

import (
	"semantic/ids"
	"semantic/enums"
)

// CollectionAlias is the alias entity binding one collection to a generation; id is its alias id (FR12, C12).
#CollectionAlias: {
	id:            ids.#CollectionAliasId
	collection:    enums.#Collection
	generation_id: ids.#GenerationId
	active:        ids.#Available
}
