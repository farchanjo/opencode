// DDD role: ValueObject
// Package: semantic.documents
// Cohesive sub-objects composed by the AgentDoc, SkillDoc and SkillChunkDoc entities
// (FR10, FR11). Taxonomy fields are first-class tag collections replacing bare arrays
// (calisthenics) and are ranking signals only, never authority (FR36, AC11). A chunk
// body ref is a Feature 005 OutputSpool handle with offset/limit — the sanitized body
// is reached by ref, never duplicated into the document or context (FR40, C9).

package semantic.documents

import (
	"semantic/ids"
	"semantic/enums"
	"semantic/values"
)

// AgentClassification carries the role, mode and sanitized description (FR10, FR36).
#AgentClassification: {
	role:        enums.#RoleKind
	mode:        ids.#ModeTag
	description: ids.#Description
}

// AgentTaxonomy carries the first-class domain, capability and tool tag collections (FR10).
#AgentTaxonomy: {
	domains:      ids.#TagSet
	capabilities: ids.#TagSet
	tools:        ids.#TagSet
}

// SkillDescriptor carries the sanitized name and description (FR11, FR36).
#SkillDescriptor: {
	name:        ids.#Name
	description: ids.#Description
}

// SkillTaxonomy carries the first-class trigger, domain and capability tag collections (FR11).
#SkillTaxonomy: {
	triggers:     ids.#TagSet
	domains:      ids.#TagSet
	capabilities: ids.#TagSet
}

// SkillCompat carries compatible role tags, agent refs and the permission ref (FR11, FR36, C11).
#SkillCompat: {
	roles:          ids.#TagSet
	agents:         ids.#AgentRefSet
	permission_ref: ids.#PermissionRef
}

// SkillCost carries the token/context cost estimate and language tags (FR11, FR38).
#SkillCost: {
	token_estimate: ids.#TokenBudget
	languages:      ids.#LanguageSet
}

// ChunkPosition carries the zero-based chunk index and fixed overlap (FR11, C9).
#ChunkPosition: {
	chunk_index: values.#ChunkIndex
	overlap:     values.#ChunkOverlap
}

// ChunkBodyRef carries the Feature 005 OutputSpool ref and its bounded read window (FR40, C9).
#ChunkBodyRef: {
	output_ref: ids.#OutputRef
	offset:     values.#ByteOffset
	limit:      values.#ByteLimit
}
