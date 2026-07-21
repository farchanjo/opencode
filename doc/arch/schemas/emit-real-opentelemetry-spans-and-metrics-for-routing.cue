// DDD role: ValueObject
// Package: schemas
// Feature 047 — the routing telemetry EMISSION contract: the span/metric names,
// the bounded structural attribute allow-list, and the hot-path safety invariants
// for emitting real OTLP signals for the four routing domains. Models the emission
// projection only; the source payloads reuse the routing schemas
// (routing/events-routing, routing/events-hierarchy, routing/budget-consumption).

package schemas

// #EmissionSignalKind is the OTLP signal family an emission rides. The four
// domains emit spans (traces) and single-point metrics only.
#EmissionSignalKind: "metrics" | "traces"

// #EmissionInstrument is the semantic instrument type an emission declares. The
// shipped OTLP/JSON encoder renders metric points as single-point gauges; the
// semantic type is the contract a future encoder upgrade honors.
#EmissionInstrument: "counter" | "histogram" | "gauge" | "span"

// #EmissionAttributeKey is the CLOSED allow-list of attribute keys any routing
// emission may carry. Structural scalars only — no key names a prompt, response,
// secret, path, or file content (FR9). `value` is the OTLP metric-point primitive
// (the measured counter/gauge value), not a semantic label.
#EmissionAttributeKey: "value" | "routing.task_class" | "routing.routing_profile" |
	"routing.hierarchy_role" | "routing.selected_model" | "routing.scope" |
	"routing.authorized_count" | "routing.decision_model_called" |
	"routing.offline" | "routing.latency_ms" | "budget.turns_used" |
	"budget.context_tokens_used" | "budget.output_tokens_used" |
	"budget.cost_usd_used" | "budget.scope" | "budget.outcome" |
	"budget.dimension" | "hierarchy.parent_role" | "hierarchy.child_role" |
	"hierarchy.fanout_requested" | "hierarchy.fanout_granted" |
	"hierarchy.admitted" | "hierarchy.denied_reason" |
	"orchestration.worker_lifecycle" | "orchestration.delivery" |
	"orchestration.validation" | "orchestration.fail_action" |
	"orchestration.pending_workers"

// #RoutingEmissionSignal is one emitted signal: a bounded name, its signal family
// and instrument, and an attribute bag whose keys are drawn only from the
// allow-list (open value shape; every value is a structural scalar).
#RoutingEmissionSignal: {
	name:       string & !=""
	kind:       #EmissionSignalKind
	instrument: #EmissionInstrument
	attributes: {[#EmissionAttributeKey]: string | int | float | bool}
}

// #EmissionSafetyContract is the hot-path invariant every routing emission MUST
// satisfy (FR6, FR7, FR8, FR9). All four flags are pinned true.
#EmissionSafetyContract: {
	non_blocking:            true // enqueue only; never awaited on the turn
	hang_safe:               true // bounded export, drop-on-failure, error-swallowed
	disabled_byte_identical: true // no allocation/transport when telemetry off
	secret_free:             true // allow-list + redaction defense-in-depth
}

// #RoutingEmissionDomain names the four domains grounded at their live seams.
#RoutingEmissionDomain: "routing.decision" | "budget.consumption" |
	"hierarchy.fanout" | "orchestration.outcome"

// #RoutingEmissionCorpus is the feature aggregate: the emitted signal set keyed by
// domain, all bound by the single safety contract.
#RoutingEmissionCorpus: {
	safety:  #EmissionSafetyContract
	signals: [#RoutingEmissionDomain]: [...#RoutingEmissionSignal]
}
