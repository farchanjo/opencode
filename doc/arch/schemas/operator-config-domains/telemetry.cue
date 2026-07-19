// DDD role: ValueObject
// Package: operator_config_domains.telemetry
// The telemetry-domain operator-surface projection (Feature 013). telemetry.*
// verbs read and mutate the effective telemetry config over the SAME
// Config.Service authority (resolveEffectiveTelemetryConfig) the routing stack
// already binds; the summary is the redacted, versioned read model and the
// configure input carries only a SecretRef for export headers — never a plaintext
// secret (FR2, FR6, Security). CUE packages are not cross-resolved by the
// structural reader; the import paths mirror the operator-menu corpus style.

package operator_config_domains.telemetry

import (
	"operator-config-domains/enums"
	"operator-config-domains/shared"
)

// SignalToggleSet is the named collection of independently toggled OTLP signal kinds; never an inline list (FR2).
#SignalToggleSet: [...enums.#TelemetryVerb]

// TelemetrySummary is the redacted telemetry read model surfaced by telemetry.status/show (FR2, Security).
#TelemetrySummary: {
	enabled:    shared.#Enabled
	configured: shared.#Configured
	available:  shared.#Available
	transport:  enums.#Transport
	endpoint:   shared.#EndpointUrl
	updatedAt:  shared.#Iso8601
	version:    shared.#Version
}

// TelemetryConfigureInput is the telemetry.configure payload; header secrets are SecretRef only, never plaintext (FR6, Security).
#TelemetryConfigureInput: {
	transport:     enums.#Transport
	endpoint:      shared.#EndpointUrl
	headerSecret?: shared.#SecretRef
	expectedVersion: shared.#Version
}
