// DDD role: ValueObject
// Package: lifecycle.usage
// LiveUsage with provenance and source (C21). Missing usage is an explicit
// unavailable state — never zero, never fabricated; unknown fields are never summed.

package lifecycle.usage

import (
	"lifecycle/ids"
	"lifecycle/enums"
)

// TokenBreakdown holds known token counts; a null field is unavailable (C21).
#TokenBreakdown: {
	input:       ids.#TokenCount | null
	output:      ids.#TokenCount | null
	reasoning:   ids.#TokenCount | null
	cache_read:  ids.#TokenCount | null
	cache_write: ids.#TokenCount | null
}

// UsageProvenanceMark records estimated-versus-reported provenance and source.
#UsageProvenanceMark: {
	provenance: enums.#UsageProvenance
	source:     enums.#UsageSource
}

// UsageAvailable flags whether a live-usage signal is present (AC25).
#UsageAvailable: bool

// LiveUsage is the honest live-usage projection for a card or row.
#LiveUsage: {
	// false renders "streaming/generating" + "tokens unavailable" (AC25).
	available:         #UsageAvailable
	tokens:            #TokenBreakdown
	cost_usd:          ids.#CostUsd | null
	provenance:        #UsageProvenanceMark
	elapsed_ms:        ids.#ElapsedMs
	tokens_per_second: ids.#TokensPerSecond | null
}
