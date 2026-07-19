// DDD role: ValueObject
// Package: operator_config_domains.probe
// The telemetry.test OTLP reachability probe (Feature 013). The probe is a real,
// environment-agnostic connectivity check against the configured export endpoint
// (http/protobuf → a minimal POST to <endpoint>/v1/metrics; grpc → a TCP dial),
// bounded by a timeout, returning a typed outcome. It is TEST-SIGNAL ONLY: it
// sends no telemetry signal content beyond the probe, never blocks the operator
// loop, and never mutates config (FR6, FR10, Feature 007 FR30). Its lifecycle is
// modeled in ../../statecharts/telemetry-probe.md.

package operator_config_domains.probe

import (
	"operator-config-domains/enums"
	"operator-config-domains/shared"
)

// ProbeTarget is the endpoint + transport the probe dials, taken from the effective telemetry config (FR6).
#ProbeTarget: {
	transport: enums.#Transport
	endpoint:  shared.#EndpointUrl
}

// ProbeResult is the typed, content-free outcome of one telemetry.test run; carries a reason on a non-reachable result (FR6, FR10).
#ProbeResult: {
	outcome:  enums.#ProbeOutcome
	target:   #ProbeTarget
	reason?:  shared.#ReasonText
}
