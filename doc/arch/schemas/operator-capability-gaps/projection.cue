// DDD role: ValueObject
// Package: operator_capability_gaps.projection
// The jobs occurrence projection + Milvus binding contracts (Feature 017, GAP F +
// GAP D). jobs.history/show-occurrences/watch project the durable job.* occurrence
// events through the same EventV2Bridge seam the lifecycle domain uses, with a
// bounded, closable watch subscription (FR11, FR12). The semantic index binds the
// milvus-adapter override when a Milvus endpoint is configured, under bounded gRPC
// probes and the url-guard SSRF policy; unconfigured degrades to the same typed
// milvus_unavailable gap (FR13, FR14). No new store or executor is introduced. CUE
// packages are not cross-resolved by the structural reader; import paths mirror
// the operator-persistence corpus style.

package operator_capability_gaps.projection

import (
	"operator-capability-gaps/enums"
	"operator-capability-gaps/shared"
	"operator-capability-gaps/flags"
)

// OccurrenceProjection is the content-free jobs occurrence read model projected over the EventV2Bridge durable seam; never a raw event payload (FR11).
#OccurrenceProjection: {
	readiness: enums.#BackendReadiness
	bridgeBound: flags.#LiveHostBound
	gap?:      enums.#ServiceGap
	reason?:   shared.#ReasonText
}

// WatchSubscription is the bounded, closable jobs.watch subscription over the durable stream; a slow consumer cannot grow memory without bound (FR12).
#WatchSubscription: {
	bounded:     flags.#WatchBounded
	bridgeBound: flags.#LiveHostBound
	gap?:        enums.#ServiceGap
}

// MilvusBinding is the semantic index/provider override bound over milvus-adapter when an endpoint is configured; unconfigured degrades to the typed gap (FR13, FR14).
#MilvusBinding: {
	endpoint?:  shared.#MilvusEndpoint
	configured: flags.#EndpointConfigured
	readiness:  enums.#BackendReadiness
	gap?:       enums.#ServiceGap
	reason?:    shared.#ReasonText
}
