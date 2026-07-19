// DDD role: ValueObject
// Package: operator_config_domains.smart
// The smart-domain operator-surface projection (Feature 013). smart.* verbs read
// and mutate RoutingConfig Activation.enabled over the SAME routing Config.Service
// authority (config key routing / global:routing) the routing port already binds;
// smart is a PROJECTION of routing config, not a second store (FR3, FR9). CUE
// packages are not cross-resolved by the structural reader; import paths mirror
// the operator-menu corpus style.

package operator_config_domains.smart

import (
	"operator-config-domains/shared"
	"operator-config-domains/enums"
)

// SmartSummary is the smart-routing read model surfaced by smart.status: the enabled/auto state projected from Activation (FR3).
#SmartSummary: {
	enabled:    shared.#Enabled
	auto:       shared.#AutoMode
	configured: shared.#Configured
	available:  shared.#Available
	authority:  shared.#AuthorityKey
	updatedAt:  shared.#Iso8601
	version:    shared.#Version
}

// SmartMutation names the smart.* mutation applied to Activation.enabled/mode under CAS (FR3, FR7).
#SmartMutation: {
	verb:            enums.#SmartVerb
	expectedVersion: shared.#Version
}
