// DDD role: ValueObject
// Package: orchestration.handoff
// Feature 053 (ORCH) — role-to-agent binding on the existing routing hierarchy,
// plus the shapes for the always-on Data -> Composer interception that runs
// BEFORE a manager-role spawn's prompt is finalized. Sits beside
// routing/config.cue (package routing.config, owner of #RoutingEnforcement)
// and semantic/*.cue (owner of #NarrowedSets/#SemanticNarrowingConfig) — this
// schema documents the DELTA Feature 053 adds on top of those shapes, never a
// duplicate or a fork of either.

package orchestration.handoff

// #BoundAgentName wraps the operator-configured role->agent binding as a named
// ValueObject (Object Calisthenics, wrap-primitives) rather than a bare
// `string`. Refers to an Agent.Info.name in the LIVE agent registry — this
// schema does not enumerate agent names, since the registry is config-composed
// at runtime (mirrors #RolePoolID in routing/config.cue, which is likewise a
// non-enumerated reference type).
#BoundAgentName: string & !~"^$"

// #HierarchyHandoffBinding documents the Feature 053 delta on top of
// routing/config.cue's `#RoutingEnforcement.hierarchy` struct (spec FR1,
// FR7; ADR-0053). THIS IS NOT A FORK: `#RoutingEnforcement.hierarchy` in
// `doc/arch/schemas/routing/config.cue` remains the single owning struct and
// gains these three fields directly (mirroring the precedent the Feature 048
// `orchestration_mode` field already set in that same struct) — this element
// exists only to document the delta's shape and constraints beside this
// feature's other new shapes. The mirrored TypeScript owner is
// `RoutingConfig.Enforcement.hierarchy`
// (`packages/schema/src/routing/config.ts`).
//
// All three fields are OPTIONAL and independently bindable:
//   - `manager_agent` — when `force_manager` classifies a spawned child as
//     "manager" (FR1), the spawn's agent is OVERRIDDEN to this bound name
//     instead of the LLM-chosen `subagent_type`. Validated with `agent.get`
//     (the SAME lookup `tool/task.ts` already performs for every spawn,
//     `packages/opencode/src/agent/agent.ts:65`) — NOT `resolveSpecialist`
//     (`:77`), which unconditionally excludes hidden agents and would reject
//     every realistic binding target (`manager-router`, `manager-composer`
//     are hidden by design). A binding that does not resolve, or whose
//     resolved `Agent.Info.model` is set (a model pin would silently
//     override the hierarchy-routed Manager-tier model), degrades to
//     TODAY'S behavior (the LLM-chosen `subagent_type` spawns unchanged)
//     plus exactly one content-free warn — never a blocked spawn.
//   - `data_agent` — the bound Data-stage agent for the FR2 interception
//     (defaults to the builtin `explore` read-only agent when absent).
//   - `composer_agent` — the bound Composer-stage agent for the FR2/FR3
//     interception. Has NO default: when absent (or invalid), the
//     interception cannot run its Composer stage, degrading FR4's whole
//     pipeline to the raw Architect prompt (FR7).
// Absent, or every field absent, is byte-identical to today: no binding
// override, no interception (FR7, AC "byte-identical when unbound").
#HierarchyHandoffBinding: {
	manager_agent?:  #BoundAgentName
	data_agent?:     #BoundAgentName
	composer_agent?: #BoundAgentName
}

// #InterceptionOutcome is one stage's content-free observation (FR8): which
// of the two synchronous, in-binary sub-session stages FR2 runs before a
// manager-role spawn's prompt is finalized ("data" | "composer" — never a
// delegation tier; `max_delegation_depth`, routing/budget.cue capped at 2,
// and `max_workers` are untouched by either stage, ADR-0053 "depth
// constraint"), how it concluded, and how long it took. `ran` succeeded
// within the shared per-stage deadline; `degraded` means the stage failed,
// timed out, or its bound agent did not resolve, and the WHOLE interception
// fell back to the raw Architect prompt (FR4); `skipped` means the gate
// never engaged for this turn (FR7 — not force_manager, or the required
// agent binding did not resolve before the stage was attempted). A single
// interception run produces one `#InterceptionOutcome` for Data and, only if
// Data ran, one for Composer.
#InterceptionOutcome: {
	stage:       "data" | "composer"
	result:      "ran" | "degraded" | "skipped"
	duration_ms: int & >=0
}

// #SyntheticFlag wraps the `RoutingSessionState` synthetic marker as a named
// ValueObject (Object Calisthenics, wrap-primitives) rather than a bare
// `bool`. True iff the session was itself created as a Data or Composer
// sub-session (`packages/opencode/src/session/routing-state.ts`).
#SyntheticFlag: bool

// #InterceptionEligible wraps the FR5 eligibility check as a named
// ValueObject rather than a bare `bool`: true iff, given `synthetic ==
// false`, the spawn's classified child role is "manager" under
// `force_manager` — the ONLY condition under which FR2's interception fires.
#InterceptionEligible: bool

// #ReentrancyGuardState is the content-free re-entrancy invariant FR5
// establishes: interception fires only when the spawning session
// (`ctx.sessionID` in `tool/task.ts`) is NOT itself a synthetic Data/Composer
// sub-session. `synthetic` mirrors the `RoutingSessionState` flag stamped on
// every Data/Composer sub-session at creation — never re-derived at the
// guard check, only read.
#ReentrancyGuardState: {
	synthetic: #SyntheticFlag
	eligible:  #InterceptionEligible
}

// #InterceptionStageLog is the FIRST-CLASS COLLECTION of stage outcomes for
// one interception attempt (Object Calisthenics — a collection type never
// mixed with scalar/struct fields in the same definition). Present only
// when `#ReentrancyGuardState.eligible && !#ReentrancyGuardState.synthetic`;
// its absence at the call site means interception never attempted for this
// spawn (FR7 gate closed, or the re-entrancy guard skipped it).
#InterceptionStageLog: [...#InterceptionOutcome] & [_, ...]

// #BriefValidationTally is FR6's bounded per-subtask brief-validation tally
// — counts only, never a list of names or subtask text. The Composer's
// brief names a specialist for each decomposed subtask, validated against
// the FULL live registry (`Agent.Service.resolveSpecialist`,
// `packages/opencode/src/agent/agent.ts:77` — never the FR3 narrowed
// retrieval catalog, which is ranking input only): `valid` needed no
// repair; `repaired` means an invalid name was replaced by the unambiguous
// highest-ranked valid specialist for that subtask; `flagged` means no
// unambiguous repair existed, so the subtask is marked in the brief for the
// Manager to route explicitly — NEVER silently dropped. Kept as its own
// named struct (Object Calisthenics, first-class collection) rather than
// folded into #OrchestrationHandoffLog directly.
#BriefValidationTally: {
	valid?:    int & >=0
	repaired?: int & >=0
	flagged?:  int & >=0
}

// #OrchestrationHandoffLog is the FR8 content-free, per-spawn observability
// record for one manager-role interception attempt: the re-entrancy guard
// state that gated it, plus references to the sibling #InterceptionStageLog
// (the stage outcomes) and #BriefValidationTally (the brief-validation
// tally) a debug-log consumer (mirroring the Feature 051/052 opt-in
// `debug_log` convention, `packages/core/src/config/experimental.ts`)
// assembles alongside this record — kept as three sibling definitions,
// never one struct mixing a collection field with scalar/struct fields.
#OrchestrationHandoffLog: {
	guard: #ReentrancyGuardState
}
