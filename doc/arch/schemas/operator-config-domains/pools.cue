// DDD role: ValueObject
// Package: operator_config_domains.pools
// The pools-domain operator-surface projection (Feature 013). pools is a
// PROJECTION of the RoutingConfig Models role_pools map, not a standalone store;
// pools.* verbs read and mutate that map over the SAME routing Config.Service
// authority the budget/smart domains bind (FR5, FR9). A small projection contract
// gives the map a bounded operator surface. CUE packages are not cross-resolved by
// the structural reader; import paths mirror the operator-menu corpus style.

package operator_config_domains.pools

import (
	"operator-config-domains/shared"
	"operator-config-domains/flags"
)

// RolePoolBinding is one role-pool key mapped to its ordered candidate model set (FR5).
#RolePoolBinding: {
	role:   shared.#RolePoolName
	models: #ModelIdList
}

// ModelIdList is the named collection of candidate model ids for a role pool; never an inline list (FR5).
#ModelIdList: [...shared.#ModelId]

// RolePoolBindingList is the named collection of role-pool bindings projected from role_pools (FR5).
#RolePoolBindingList: [...#RolePoolBinding]

// PoolsProjection is the pools read model surfaced by pools.status/show: the projected bindings over routing config (FR5).
#PoolsProjection: {
	configured: flags.#Configured
	available:  flags.#Available
	valid:      flags.#Valid
	bindings:   #RolePoolBindingList
	updatedAt:  shared.#Iso8601
	version:    shared.#Version
}
