// DDD role: AggregateRoot
// Package: semantic.index
// IndexGeneration — one blue/green collection generation under a binding generation
// (FR12, C12). It is the aggregate root of a generation; its id is the generation_id.
// The embedding dimension, normalization and metric are stored WITH the generation so
// incompatible vectors are never mixed in one search space (FR12). select and reindex
// never activate the live alias; only the atomic semantic.embedding.cutover under CAS
// swaps all collection aliases together (FR12, FR32, C12). The alias entity lives in
// collection-alias.cue.

package semantic.index

import (
	"semantic/ids"
	"semantic/enums"
	"semantic/values"
)

// IndexGeneration is the aggregate root of a blue/green generation; id is the generation id (FR12, C12).
#IndexGeneration: {
	id: ids.#GenerationId

	// The binding version this generation was built for (FR12, C12).
	binding_version: values.#BindingVersion

	// The blue/green lifecycle state (building/validated/live/superseded/retired) (FR12, C12).
	state: enums.#GenerationState

	// The stored distance metric on normalized vectors (FR12, C7).
	metric: enums.#Metric

	// The stored embedding dimensionality; never inferred (FR12, C7).
	dimension: values.#Dimension

	// The collection aliases swapped together at cutover (FR12, C12).
	aliases: ids.#AliasRefSet

	// The generation build time (FR12).
	created_at: ids.#Timestamp
}
