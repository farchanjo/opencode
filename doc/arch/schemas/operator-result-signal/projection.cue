// DDD role: ValueObject
// Package: operator_result_signal.projection
// The per-domain panel projection (Feature 012). A pure function maps an effective
// payload to one of the five read-domain panel signals, validating the shape and
// degrading to the honest EMPTY_*_SIGNAL on absence or mismatch — it never throws
// or synthesizes rows (FR4, FR5, FR8). CUE packages are not cross-resolved by the
// structural reader; the import paths mirror the operator-menu corpus style.

package operator_result_signal.projection

import (
	"operator-result-signal/enums"
	"operator-result-signal/shared"
)

// PanelProjection is one read domain's projection result: the target domain, the outcome, and the effective payload when projected (FR4, FR5).
#PanelProjection: {
	domain:     enums.#ProjectionDomain
	outcome:    enums.#ProjectionOutcome
	effective?: shared.#EffectivePayload
}

// ProjectionList is the first-class collection of panel projections across the read domains (FR4).
#ProjectionList: [...#PanelProjection]
