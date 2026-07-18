// DDD role: Entity
// Package: semantic.documents
// SkillDoc — one canonical skill summary projected into the `skills` collection (FR11).
// It is an Entity: its id is the canonical skill id with stable identity across
// content-hash upserts. Skills are lazy — the summary is indexed first and full bodies
// are chunked separately (FR39). Triggers, domains and capabilities are ranking signals
// only (FR36). Compatible roles/agents and the permission ref keep visibility metadata
// so a plugin/custom source cannot claim elevated permission (FR36, C11). No secret,
// prompt, reasoning, or path is stored (FR17, C4). Cohesive parts live in document-parts.cue.

package semantic.documents

import "semantic/ids"

// SkillDoc is the `skills` collection summary projection entity; id is the canonical skill id (FR11, C9).
#SkillDoc: {
	id:           ids.#SkillDocId
	identity:     #DocIdentity
	descriptor:   #SkillDescriptor
	taxonomy:     #SkillTaxonomy
	compat:       #SkillCompat
	cost:         #SkillCost
	availability: #DocAvailability
}
