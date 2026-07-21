// DDD role: ValueObject
// Package: schemas
// Feature 045 — always-mode Smart Routing activation. Models the per-mode
// engagement policy: which routing subsystems engage and whether routing
// re-evaluates each turn. The activation MODE itself is bound by
// routing/config.cue (#RoutingMode); this file models the DERIVED policy the
// runtime gates on, so `always` is provably a strict superset of `auto`.

package schemas

import "routing/config"

// #ReevaluationPolicy names when the session model-selection seam re-consults the
// routing engine across a session's turns.
#ReevaluationPolicy: "no_routing" | "first_turn_only" | "every_turn"

// #GateEngaged is a named ValueObject wrapping the engage/skip decision of a
// single routing gate, so engagement is never a bare primitive.
#GateEngaged: bool

// #SubsystemEngagement records whether each downstream routing subsystem engages
// under a given activation mode. Every gate admits `mode != "never"`, so the four
// gates CONVERGE (Feature 045) instead of `auto`-only diverging from budget.
#SubsystemEngagement: {
	// F037 implicit-default model resolution (routing-resolve.ts gate).
	model_resolution: #GateEngaged
	// F042 per-subagent hierarchy delegation + fan-out admission.
	hierarchy_delegation: #GateEngaged
	// F043 live budget consumption + fan-out admission.
	budget_enforcement: #GateEngaged
	// F044 Manager completion gate over the orchestration aggregate.
	orchestration_gate: #GateEngaged
}

// #ModeActivation binds a mode to its re-evaluation policy and subsystem
// engagement. The explicit-model invariant is unconditional: an explicit
// `--model` / agent-pinned model always wins, in EVERY mode.
#ModeActivation: {
	mode:                #RoutingMode
	reevaluation:        #ReevaluationPolicy
	engages:             #SubsystemEngagement
	explicit_model_wins: bool & true
}

// #RoutingMode reuses the canonical activation triad.
#RoutingMode: config.#RoutingMode

// #ActivationMatrix enumerates the three canonical activations. `always` engages
// every subsystem `auto` engages (superset) and adds every-turn re-evaluation;
// `never` is the no-op path (byte-identical to no routing).
#ActivationMatrix: {
	never: #ModeActivation & {
		mode:        "never"
		reevaluation: "no_routing"
		engages: {model_resolution: false, hierarchy_delegation: false, budget_enforcement: false, orchestration_gate: false}
	}
	auto: #ModeActivation & {
		mode:        "auto"
		reevaluation: "first_turn_only"
		engages: {model_resolution: true, hierarchy_delegation: true, budget_enforcement: true, orchestration_gate: true}
	}
	always: #ModeActivation & {
		mode:        "always"
		reevaluation: "every_turn"
		engages: {model_resolution: true, hierarchy_delegation: true, budget_enforcement: true, orchestration_gate: true}
	}
}
