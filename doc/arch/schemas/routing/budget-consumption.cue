// DDD role: ValueObject
// Package: routing.budget
// BudgetConsumption — observed spend measured against a BudgetPolicy.

package routing.budget

// ConsumptionThroughput records turn, token and byte spend.
#ConsumptionThroughput: {
	turns_used:          uint & >=0
	context_tokens_used: uint & >=0
	output_tokens_used:  uint & >=0
	context_bytes_used:  uint & >=0
	output_bytes_used:   uint & >=0
}

// ConsumptionConcurrency records worker and delegation spend.
#ConsumptionConcurrency: {
	workers_requested:     uint & >=0
	workers_granted:       uint & >=0
	delegation_depth_used: uint & >=0
}

// ConsumptionRetrieval records retrieval, rerank and skill-context spend.
#ConsumptionRetrieval: {
	retrieval_chunks_used: uint & >=0
	rerank_chunks_used:    uint & >=0
	skill_chunks_used:     uint & >=0
	skill_tokens_used:     uint & >=0
}

// ConsumptionCost records wall-clock and monetary spend.
#ConsumptionCost: {
	time_ms_used:  uint & >=0
	cost_usd_used: float & >=0.0
}

// ConsumptionResilience records retry, validation and escalation counts.
#ConsumptionResilience: {
	retry_count:      uint & >=0
	validation_count: uint & >=0
	escalation_count: uint & >=0
}

// BudgetConsumption composes observed spend across all budget dimensions.
#BudgetConsumption: {
	throughput:  #ConsumptionThroughput
	concurrency: #ConsumptionConcurrency
	retrieval:   #ConsumptionRetrieval
	cost:        #ConsumptionCost
	resilience:  #ConsumptionResilience
}
