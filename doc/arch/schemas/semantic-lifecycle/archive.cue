// DDD role: ValueObject
// Package: semantic_lifecycle.archive
// The per-slot binding VERSION ARCHIVE (Feature 019, Group A). Today the operator
// RegistryDocument carries a single binding entry per slot (registry-backend.ts
// bindingHistory returns one), a hardcoded full_semantic bindingStatus rung, and no
// superseded target for a rollback. Feature 019 extends the document with a per-slot
// archive — the current version plus its superseded predecessors — so rollback has a
// real target and bindingHistory/bindingStatus become real. A rollback with no
// archived prior is a typed rejection, never a fabricated swap (Group A). CUE
// packages are not cross-resolved by the structural reader.

package semantic_lifecycle.archive

import (
	"semantic-lifecycle/enums"
	"semantic-lifecycle/shared"
	"semantic-lifecycle/flags"
)

// ArchivedBindingVersion is one immutable entry in a slot's version archive; a superseded entry is a real rollback target, a current entry is the live-aliased version (Group A).
#ArchivedBindingVersion: {
	slot:      shared.#Slot
	version:   shared.#BindingVersion
	modelRef:  shared.#ModelRef
	state:     enums.#BindingState
	kind:      enums.#ArchiveEntryKind
	validated: flags.#CandidateValidated
}

// SupersededVersions is the first-class collection of a slot's superseded prior versions, ordered newest-first; each is a real rollback target (Group A).
#SupersededVersions: [...#ArchivedBindingVersion]

// BindingVersionArchive is the per-slot archive the operator document carries: exactly one current entry and its superseded priors, so bindingHistory and rollback read real data (Group A).
#BindingVersionArchive: {
	slot:       shared.#Slot
	current:    #ArchivedBindingVersion
	superseded: #SupersededVersions
}

// RollbackTarget is the resolved prior a reranker/embedding rollback restores; unresolved when the archive holds no superseded entry, which the plan reports as a typed no_archived_prior rejection (Group A).
#RollbackTarget: {
	slot:           shared.#Slot
	targetVersion:  shared.#BindingVersion
	targetModelRef: shared.#ModelRef
	resolved:       flags.#RollbackResolved
	reason?:        shared.#ReasonText
}
