// DDD role: ValueObject
// Package: operator_config_domains.budget
// The budget-domain operator-surface projection (Feature 013). budget.* verbs read
// and mutate the RoutingConfig Enforcement budget over the SAME routing
// Config.Service authority, seeded from DEFAULT_ROUTING_BUDGET until an operator
// supplies a policy; the ceiling is never silently relaxed (FR4, FR9). The view is
// a bounded projection of the effective limits, not the full nested policy. CUE
// packages are not cross-resolved by the structural reader; import paths mirror
// the operator-menu corpus style.

package operator_config_domains.budget

import (
	"operator-config-domains/shared"
	"operator-config-domains/flags"
)

// BudgetCount is one bounded non-negative limit value in the effective budget view (FR4).
#BudgetCount: uint & >=0

// BudgetLimitsView is the bounded projection of the effective turn/token limits surfaced by budget.show (FR4).
#BudgetLimitsView: {
	maxTurns:          #BudgetCount
	maxContextTokens:  #BudgetCount
	maxOutputTokens:   #BudgetCount
	maxWorkers:        #BudgetCount
	tokenBudget:       #BudgetCount
}

// BudgetSummary is the budget read model surfaced by budget.status/show; validate reports Valid without mutating (FR4).
#BudgetSummary: {
	configured: flags.#Configured
	available:  flags.#Available
	valid:      flags.#Valid
	limits:     #BudgetLimitsView
	updatedAt:  shared.#Iso8601
	version:    shared.#Version
}
