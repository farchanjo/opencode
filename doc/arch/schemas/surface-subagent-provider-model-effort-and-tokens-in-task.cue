// DDD role: ValueObject

package schemas

// #TaskCompletionUsage models the Feature 054 completion-time enrichment of the
// task tool part's metadata envelope: the executor coordinates the spawn already
// stamps, plus the child session's final token counters and the config-derived
// reasoning effort. Every field beyond the spawn-time `model` pair is optional —
// an absent field degrades that segment of the rendered line individually, and a
// metadata envelope with none of them renders byte-identically to pre-054.
// DDD role: ValueObject
#TaskCompletionUsage: {
	// Spawn-time executor coordinates (pre-existing, always present).
	model: {
		providerID: string & !=""
		modelID:    string & !=""
	}
	// Config-derived reasoning effort for the routed model; omitted when the
	// merged config declares none (never fabricated).
	effort?: string & !=""
	// Final child-session token counters, read from the in-process session
	// record at completion; omitted when the read degrades.
	tokens?: {
		input:     int & >=0
		output:    int & >=0
		reasoning: int & >=0
		cache: {
			read:  int & >=0
			write: int & >=0
		}
	}
}
