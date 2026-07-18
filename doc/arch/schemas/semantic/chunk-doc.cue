// DDD role: Entity
// Package: semantic.documents
// SkillChunkDoc — one bounded, sanitized body chunk projected into the `skill_chunks`
// collection (FR11, C9). It is an Entity: its id is the canonical chunk id with stable
// identity across content-hash upserts. The chunk body is NEVER stored inline — only a
// Feature 005 OutputSpool ref with offset/limit, injected after Agent/role selection
// under the C8 budget (FR39, FR40, C9). Chunking strips secrets, prompts, reasoning and
// paths (FR17, C4). Cohesive parts live in document-parts.cue.

package semantic.documents

import "semantic/ids"

// SkillChunkDoc is the `skill_chunks` projection entity; id is the canonical chunk id (FR11, C9).
#SkillChunkDoc: {
	id:              ids.#SkillChunkId
	parent_skill_id: ids.#ParentSkillId
	position:        #ChunkPosition
	identity:        #DocIdentity
	language_tag:    ids.#LanguageTag
	body_ref:        #ChunkBodyRef
	token_estimate:  ids.#TokenBudget
}
