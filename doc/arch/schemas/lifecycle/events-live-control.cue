// DDD role: ValueObject
// Package: lifecycle.events
// Live steer, cancel-intent and tool-boundary event members (C4). extend,
// promote, steer and handoff remain distinct semantic events (FR21). Tool
// boundaries are priority and survive coalescing (C10, FR57).

package lifecycle.events

import "lifecycle/envelope"

// steer_requested — a steer was requested through a native control API (FR16).
#LifecycleSteerRequestedEvent: {
	type:     "lifecycle.steer_requested"
	envelope: envelope.#LifecycleEnvelope
	detail:   #SteerDetail
}

// steer_accepted — the steer request was accepted.
#LifecycleSteerAcceptedEvent: {
	type:     "lifecycle.steer_accepted"
	envelope: envelope.#LifecycleEnvelope
	detail:   #SteerDetail
}

// steer_rejected — the steer request was rejected.
#LifecycleSteerRejectedEvent: {
	type:     "lifecycle.steer_rejected"
	envelope: envelope.#LifecycleEnvelope
	detail:   #SteerDetail
}

// cancel_requested — a cancel was requested; no remote kill is promised (C17).
#LifecycleCancelRequestedEvent: {
	type:     "lifecycle.cancel_requested"
	envelope: envelope.#LifecycleEnvelope
	detail:   #SteerDetail
}

// cancelling — the process is transitioning toward a terminal cancel outcome.
#LifecycleCancellingEvent: {
	type:     "lifecycle.cancelling"
	envelope: envelope.#LifecycleEnvelope
	detail:   #SteerDetail
}

// tool_called — a tool boundary opened; activity is allowlisted and redacted (FR56).
#LifecycleToolCalledEvent: {
	type:     "lifecycle.tool_called"
	envelope: envelope.#LifecycleEnvelope
	detail:   #ToolActivityDetail
}

// tool_settled — a tool boundary settled.
#LifecycleToolSettledEvent: {
	type:     "lifecycle.tool_settled"
	envelope: envelope.#LifecycleEnvelope
	detail:   #ToolActivityDetail
}
