// DDD role: ValueObject
// Package: outputspool.retention
// RetentionDescriptor, RetentionLease and the reference-edge graph (FR28-FR30, C5).
// Retention is reference-aware, never mtime-only: a group is reclaimable only when
// its TTL has elapsed AND it holds no live lease, no active reader/writer, no
// inbound reference edge and no legal/privacy hold (AC16). release drops one holder
// edge; cleanup reclaims only fully unreferenced expired groups in bounded batches
// (FR30, AC17). Per-channel TTL defaults (reasoning stricter per C9) are plan
// constants with hooks AC16/AC17.

package outputspool.retention

import (
	"outputspool/ids"
	"outputspool/enums"
)

// TtlMs bounds the retention TTL for a group; provisional plan constant (FR28, C5, AC16).
#TtlMs: uint & >=0

// RetentionLease is one live holder lease that blocks reclamation while held (FR28, C5, AC16).
#RetentionLease: {
	lease_id:   ids.#LeaseId
	holder_ref: ids.#HolderRef
	granted_at: ids.#Timestamp
	expires_at: ids.#Timestamp | null
}

// ReferenceEdge is one inbound reference that gates cleanup (FR28, C5, AC16).
#ReferenceEdge: {
	kind:       enums.#RetentionEdgeKind
	holder_ref: ids.#HolderRef
}

// ReferenceEdgeSet is the first-class collection of inbound reference edges (FR28, C5).
#ReferenceEdgeSet: [...#ReferenceEdge]

// RetentionDescriptor binds TTL, legal hold, optional lease and the inbound edge set (FR28-FR30, C5, AC16).
#RetentionDescriptor: {
	ttl_ms:     #TtlMs
	legal_hold: enums.#LegalHoldState
	lease:      #RetentionLease | null
	edges:      #ReferenceEdgeSet
}
