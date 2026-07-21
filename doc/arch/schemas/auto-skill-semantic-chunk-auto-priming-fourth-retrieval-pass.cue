// DDD role: ValueObject
// Package: semantic.autoskill
// Feature 052 (SR-C) — new config/data shapes for the fourth retrieval pass
// over `skill_chunks` and the `<auto_skills>` Tier-2 auto-priming block. Sits
// beside wire-live-per-turn-semantic-narrowing-of-agents-skills-and.cue
// (Feature 051, package semantic.livequery), which owns `#SemanticNarrowingConfig`
// and `#NarrowedSets` unmodified — this schema documents the DELTA Feature 052
// adds on top of that shape, never a duplicate or a fork of it.

package semantic.autoskill

// #ScoreFloor wraps the rerank confidence threshold as a named ValueObject
// (Object Calisthenics, wrap-primitives), reusing the SAME real-valued [0,1]
// domain `SemanticScore.confidence` already carries
// (`packages/protocol/src/semantic/commands.ts` `SemanticScore.confidence`).
// The strict default (0.75) means a mediocre-confidence hit is left to Tier-1
// listing rather than auto-injected (FR2).
#ScoreFloor: number & >=0 & <=1 | *0.75

// #AutoSkillConfig is the Feature 052 config surface: a gate SEPARATE from,
// but composing WITH, the Feature 051 `#SemanticNarrowingConfig.skills` gate
// (spec FR1) — `skill_autoprime` enabled with the skills surface disabled is
// still fully off; this schema never duplicates the skills gate itself.
// Absent, or `enabled: false`, is the full Tier-1-only floor: no fourth
// retrieval pass, no `<auto_skills>` block, byte-identical to Feature 051
// behavior (FR1, AC5 "gates off").
#AutoSkillConfig: {
	// Default false (FR1). The composed effective gate a caller resolves is
	// `skill_autoprime.enabled && semantic_narrowing.skills.enabled`.
	enabled: bool | *false

	// The minimum rerank confidence a `skill_chunk` candidate must clear to be
	// injected (FR2). Zero qualifying candidates -> no `<auto_skills>` block;
	// Tier-1 `<available_skills>` listing is entirely unaffected.
	score_floor: #ScoreFloor
}

// #PackRef wraps the pulled remote-pack URL as a named ValueObject (Object
// Calisthenics, wrap-primitives) rather than a bare `string`.
#PackRef: string & !=""

// #SkillProvenance is the trust-boundary marker Feature 052 adds to both
// `Skill.Info` (`packages/opencode/src/skill/index.ts`) and `SkillDoc`
// (`packages/schema/src/semantic/documents.ts`) so Tier-2 auto-injection can
// tell a user-authored LOCAL skill from a remote `cfg.skills.urls` pack
// (spec FR5, ADR-0052). A remote pack is discovered and Tier-1-listed
// identically to today; it is NEVER auto-injected unless its OWN
// `autoprime_opt_in` is explicitly true.
#SkillProvenance: {
	source: "local" | "remote-pack"

	// The pulled URL, present only when source is "remote-pack".
	pack_ref?: #PackRef

	// Default false — a remote pack must explicitly opt in per-pack before
	// ANY of its skill_chunks are eligible for Tier-2 auto-injection (FR5).
	// Ignored (never consulted) when source is "local", since local skills
	// are unconditionally Tier-2-eligible subject only to #ScoreFloor.
	autoprime_opt_in: bool | *false
}

// #AutoSkillChunkRef is one ranked, revalidated skill_chunk hit surviving
// FR1 (retrieval) + FR2 (confidence floor) + FR5 (local-only provenance) +
// FR6 (session dedup) — the shape `NarrowedSets.chunks` (Feature 051's
// `#NarrowedSets`, extended here) and the render pass consume. `chunkId` is
// the canonical `SkillChunkDoc.id`; `skillName` is the parent skill's
// canonical name (`SkillChunkDoc.parent_skill_id`, resolved to a display
// name at render); `score` is the candidate's `SemanticScore.confidence`
// that cleared `#ScoreFloor`.
#AutoSkillChunkRef: {
	chunkId:   string & !=""
	skillName: string & !=""
	score:     #ScoreFloor
}

// #NarrowedSetsChunksExtension documents the Feature 052 delta on top of
// Feature 051's `#NarrowedSets` (`wire-live-per-turn-semantic-narrowing-of-agents-skills-and.cue`):
// one new OPTIONAL field, `chunks`, following the SAME absent-means-passthrough /
// present-non-empty-means-narrowed convention as `agents`/`skills`/`tools` — a
// present-but-empty list is never valid (every degenerate/below-floor/deduped
// outcome normalizes to absent before this field is written, FR2/FR6). This is
// NOT a second `#NarrowedSets` type; Feature 051's TypeScript `NarrowedSets`
// interface (`packages/opencode/src/session/routing-state.ts`) is the single
// implementation this schema element extends in place.
#NarrowedSetsChunksExtension: {
	chunks?: [...#AutoSkillChunkRef] & [_, ...]
}

// #AutoSkillBudget is the render-time budget FR4 enforces, kept as its own
// named struct (not mixed into a collection type, Object Calisthenics
// first-class-collection). `max_chunks`/`max_tokens` are NOT new constants —
// they reference the EXISTING Feature 001 routing budget fields
// `Budget.Retrieval.max_skill_chunks` / `max_skill_tokens`
// (`packages/schema/src/routing/budget.ts`), which Feature 051 already
// reserved exclusively for a future Tier-2 pass and never spent on Tier-1
// listing. `#AutoSkillsBlock` spends them for the first time.
#AutoSkillBudget: {
	// Mirrors `Budget.Retrieval.max_skill_chunks` (PositiveInt) — the cap on
	// how many resolved chunk bodies this block may concatenate.
	max_chunks: int & >0

	// Mirrors `Budget.Retrieval.max_skill_tokens` (PositiveInt) — the
	// cumulative `Token.estimate` cap over every resolved chunk body in this
	// block; enforcement stops appending once the cap would be exceeded.
	max_tokens: int & >0
}

// #AutoSkillsBlock is the rendered `<auto_skills>` system-prompt payload
// (FR3): a first-class collection of resolved, budget-truncated chunk
// entries — the budget knobs themselves live in the sibling `#AutoSkillBudget`
// struct, never mixed into this collection type.
#AutoSkillsBlock: [...#AutoSkillChunkRef]
