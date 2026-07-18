// DDD role: ValueObject
// Package: routing.capability
// Structured decision-model inputs and outputs — no raw prompts or model text.

package routing.capability

import (
	"routing/ids"
	"routing/enums"
)

// ExpectedTools is the first-class collection of tool names a task expects.
#ExpectedTools: [...ids.#SkillName]

// InputStructure captures the structural shape of the task.
#InputStructure: {
	domain_count:      uint & >=0
	independent_units: uint & >=0
	context_size:      uint & >=0
}

// InputRisk captures normalised risk signals in [0.0, 1.0].
#InputRisk: {
	mutation_risk:      float & >=0.0 & <=1.0
	ambiguity:          float & >=0.0 & <=1.0
	security_migration: float & >=0.0 & <=1.0
	external_effects:   float & >=0.0 & <=1.0
}

// InputConcurrency captures expected tooling and parallelism.
#InputConcurrency: {
	expected_tools: #ExpectedTools
	parallelism:    float & >=0.0 & <=1.0
}

// DecisionInputs captures the structured inputs passed to a decision model.
// No raw prompts — structured signals only.
#DecisionInputs: {
	structure:   #InputStructure
	risk:        #InputRisk
	concurrency: #InputConcurrency
}

// DecisionOutput captures the structured output from a decision model.
// No raw model text — typed signals only.
#DecisionOutput: {
	recommended_profile:    enums.#RoutingProfile
	recommended_task_class: enums.#TaskClass
	confidence:             float & >=0.0 & <=1.0
	reason:                 ids.#Reason
}
