// DDD role: ValueObject

package schemas

// #RetrievalConsumptionDelta is the optional per-turn retrieval spend folded into
// Budget.Consumption.retrieval (Feature 055). All fields optional so pre-055
// deltas remain byte-identical when omitted.
// DDD role: ValueObject
#RetrievalConsumptionDelta: {
	retrievalChunks?: int & >=0
	rerankChunks?:    int & >=0
	skillChunks?:     int & >=0
	skillTokens?:     int & >=0
}

// #ValidationConsumptionDelta increments resilience.validation_count.
// DDD role: ValueObject
#ValidationConsumptionDelta: {
	validations?: int & >=0
}
