// DDD role: ValueObject
// Package: operator_persistence.backends
// The service-backend readiness projection (Feature 014). The composition root
// wires real backends where a clean dependency edge exists — the OutputSpool
// control store (live), the MCP admin host (live), and the config-backed half of
// the semantic registry (mixed) — while the Milvus-gated, executor-gated, and
// lifecycle-cancel ops stay typed capability gaps by design (FR6, FR7, FR8, FR9,
// FR10). The readiness class drives the grouped-menu Partial badge honestly
// (FR12). CUE packages are not cross-resolved by the structural reader; import
// paths mirror the operator-config-domains corpus style.

package operator_persistence.backends

import (
	"operator-persistence/enums"
	"operator-persistence/shared"
)

// GatedOpList is the named collection of command ids that remain a typed capability gap on a mixed backend; never an inline list (FR8, FR9).
#GatedOpList: [...shared.#CommandId]

// ServiceBackend is one service-backed domain's wiring readiness and the ops still gated behind an unreachable dependency (FR6, FR8, FR12).
#ServiceBackend: {
	domain:    enums.#ServiceBackedDomain
	readiness: enums.#BackendReadiness
	gap?:      enums.#ServiceGap
	gatedOps:  #GatedOpList
}

// SemanticRegistrySplit records the mixed semantic domain: the config-backed registry ops persist while the Milvus-gated index ops do not (FR8).
#SemanticRegistrySplit: {
	configBacked: #GatedOpList
	milvusGated:  #GatedOpList
}
</content>
