// DDD role: ValueObject
// Package: schemas
// Feature 059 — superseded by Feature 060; pointer-only ValueObject.

package schemas

// DurableToolOutputBuffersAndPrimaryChatOutputBudgetName is a non-empty
// supersession label pointing maintainers at Feature 060.
// DDD role: ValueObject
#DurableToolOutputBuffersAndPrimaryChatOutputBudgetName: string & !=""

// DurableToolOutputBuffersAndPrimaryChatOutputBudget is a stub shape for the
// archived 059 slug; the real model lives under Feature 060.
// DDD role: ValueObject
#DurableToolOutputBuffersAndPrimaryChatOutputBudget: {
	name:              #DurableToolOutputBuffersAndPrimaryChatOutputBudgetName
	superseded_by_nnn: 60
}
