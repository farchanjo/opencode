// DDD role: Entity
// Package: semantic.documents
// AgentDoc — one canonical agent projected into the `agents` collection (FR10). It is
// an Entity: its id is the canonical agent id with stable identity across content-hash
// upserts. Description, domains, capabilities and tools are ranking signals only; a
// malicious description never alters router policy or hard gates (FR36, AC11). Volatile
// health/cost are NEVER embedded as authority fields (FR10, FR23). Every candidate is
// revalidated against live AgentV2/Permission before injection (FR20, C11). Cohesive
// parts live in document-parts.cue.

package semantic.documents

import "semantic/ids"

// AgentDoc is the `agents` collection projection entity; id is the canonical agent id (FR10, C6).
#AgentDoc: {
	id:             ids.#AgentDocId
	identity:       #DocIdentity
	classification: #AgentClassification
	taxonomy:       #AgentTaxonomy
	scope:          #DocScope
	languages:      ids.#LanguageSet
	availability:   #DocAvailability
}
