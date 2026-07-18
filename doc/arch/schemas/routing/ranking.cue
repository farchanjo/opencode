// DDD role: ValueObject
// Package: routing.decision
// Ranked candidates and the authorization snapshot captured at decision time.

package routing.decision

import "routing/ids"

// TieBreakApplied flags whether deterministic tie-break resolution ran.
#TieBreakApplied: bool

// HardGatesAuthoritative flags whether hard gates override the decision model.
#HardGatesAuthoritative: bool

// CandidateList is the first-class collection of evaluated candidates.
#CandidateList: [...#CandidateRecord]

// RankingList is the first-class collection of ranked candidates.
#RankingList: [...#RankedCandidate]

// RankedCandidate is a candidate after deterministic tie-break resolution.
#RankedCandidate: {
	agent_id:          ids.#AgentId
	model_id:          ids.#ModelId
	rank:              uint & >=1
	score_breakdown:   {[string]: float & >=0.0}
	tie_break_applied: #TieBreakApplied
}

// AuthContextSnapshot captures authorization state at decision time.
#AuthContextSnapshot: {
	permission_mode:          ids.#PermissionMode
	policy_version:           ids.#PolicyVersion
	hard_gates_authoritative: #HardGatesAuthoritative
}
