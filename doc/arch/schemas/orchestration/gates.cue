// DDD role: ValueObject
// Package: orchestration
// Feature 044 Leaf B (FR-B) — the completion gate that holds a Manager turn open
// while any delegated Worker is pending — and Leaf C (FR-C) — the ordered
// SHAPE -> POLICY -> DOMAIN validation chain each Worker result passes before the
// Manager accepts it into the aggregate.

package orchestration

// CompletionGateOutcome is the typed completion-gate result: ok when every
// delegated Worker is terminal, blocked while any is pending (FR-B1).
// DDD role: ValueObject
#CompletionGateOutcome: "ok" | "blocked"

// CompletionGateResult holds the Manager turn open while any Worker is pending
// (FR-B1, FR-B3). A failed/aborted Worker is terminal and surfaces (FR-B2); it does
// not keep the gate blocked. Reuses the pure completionGate blocked vocabulary.
// DDD role: ValueObject
#CompletionGateResult: {
	outcome:         #CompletionGateOutcome
	pending_workers: #Count
	// A blocked outcome MUST name at least one pending Worker; an ok outcome none.
	if outcome == "blocked" {
		pending_workers: #Count & >=1
	}
	if outcome == "ok" {
		pending_workers: 0
	}
}

// ValidationStage names one ordered stage of the acceptance chain: shape (a
// decodable result envelope), policy (legal for role + orchestration_only), domain
// (required Todo items completed) (FR-C1).
// DDD role: ValueObject
#ValidationStage: "shape" | "policy" | "domain"

// ValidationFailAction is the defined action when a stage fails (FR-C2): reject a
// malformed result, reject-and-maybe-redispatch an illegal one, or surface a
// blocked reason for a domain-incomplete one. No stage silently passes a failure.
// DDD role: ValueObject
#ValidationFailAction: "reject" | "reject_redispatch" | "surface_blocked"

// StageVerdict is one stage's pass/fail as a constrained ValueObject rather than a
// bare boolean (Object Calisthenics, wrap-primitives).
// DDD role: ValueObject
#StageVerdict: "passed" | "failed"

// ValidationStageResult is one stage's outcome; a failed stage carries its
// fail-action and a bounded reason (FR-C2). A passed stage carries neither.
// DDD role: ValueObject
#ValidationStageResult: {
	stage:   #ValidationStage
	verdict: #StageVerdict
	if verdict == "failed" {
		fail_action: #ValidationFailAction
		reason:      #FailureReason
	}
}

// AcceptanceVerdict is the chain's overall acceptance as a constrained ValueObject
// rather than a bare boolean (Object Calisthenics, wrap-primitives).
// DDD role: ValueObject
#AcceptanceVerdict: "accepted" | "rejected"

// ValidationStages is the first-class ordered collection of stage results — a
// collection-only ValueObject (Object Calisthenics, first-class collection).
// DDD role: ValueObject
#ValidationStages: {
	// Ordered shape-first; fail-fast means a rejected result stops the chain.
	ordered: [...#ValidationStageResult]
}

// WorkerValidationChain is the ordered evaluation of a Worker result at acceptance
// (FR-C1, FR-C3): stages run shape then policy then domain, each only if the prior
// passed. It hooks after the dispatch record and before the aggregate fold.
// DDD role: ValueObject
#WorkerValidationChain: {
	child_session_id: #SessionId
	stages:           #ValidationStages
	acceptance:       #AcceptanceVerdict
}
