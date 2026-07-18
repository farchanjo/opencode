// DDD role: ValueObject
// Package: routing.decision
// Hard-gate results and evaluated candidate records before ranking.

package routing.decision

import (
	"routing/ids"
	"routing/enums"
	"routing/capability"
)

// GatePassed flags whether a single hard-gate dimension passed.
#GatePassed: bool

// GateResult records a single hard-gate evaluation dimension.
#GateResult: {
	dimension:       ids.#CapabilityDimension // e.g. "tool_call_present"
	passed:          #GatePassed
	reason:          ids.#Reason
	requirement:     ids.#Requirement                 // what the task required
	candidate_value: capability.#ToolCapabilityValue  // what the candidate provided
	scope:           ids.#Scope                        // provider/model/variant/API
}

// GateList is the first-class collection of hard-gate results.
#GateList: [...#GateResult]

// SkillList is the first-class collection of selected skill names.
#SkillList: [...ids.#SkillName]

// RejectionReasons is the first-class collection of candidate rejection reasons.
#RejectionReasons: [...ids.#Reason]

// CandidateRejected flags whether a candidate was rejected.
#CandidateRejected: bool

// CandidateIdentity locates a candidate by agent and model.
#CandidateIdentity: {
	agent_id: ids.#AgentId
	model_id: ids.#ModelId
}

// CandidateProfile captures the candidate's skills and effort profile.
#CandidateProfile: {
	skills:           #SkillList
	effort:           enums.#TaskEffort
	reasoning_effort: enums.#ReasoningEffort
}

// CandidateOutcome captures the scoring and rejection outcome.
#CandidateOutcome: {
	gate_results:      #GateList
	final_score:       float & >=0.0
	rank:              uint & >=1
	rejected:          #CandidateRejected
	rejection_reasons: #RejectionReasons
}

// CandidateRecord captures a single evaluated candidate before ranking.
#CandidateRecord: {
	identity: #CandidateIdentity
	profile:  #CandidateProfile
	outcome:  #CandidateOutcome
}
