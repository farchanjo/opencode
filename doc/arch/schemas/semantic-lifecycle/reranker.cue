// DDD role: ValueObject
// Package: semantic_lifecycle.reranker
// The config-backed reranker cutover/rollback activation (Feature 019, Group A). The
// pure engine already exists — cutover-executor.ts cutoverReranker takes NO MilvusPort
// and returns committed/confirmation_required; binding-lifecycle.ts TRANSITIONS types
// the legal edges. Feature 019 exposes these as OperatorMutationPlans routed through
// the config-backed registry (semantic-command-port.ts rerankerInvoke moves cutover/
// rollback off the gated Milvus backend onto c.registry), invalidating the rerank
// cache/eval version under CAS + confirmation with NO re-embedding. A cutover without
// a validated staged candidate is not_validated; a rollback without an archived prior
// is rejected (Group A). CUE packages are not cross-resolved by the structural reader.

package semantic_lifecycle.reranker

import (
	"semantic-lifecycle/enums"
	"semantic-lifecycle/shared"
	"semantic-lifecycle/flags"
)

// RerankerCutoverPlan is the mutation plan a reranker cutover dispatches through the config-backed registry under mutateAuthority; it carries no Milvus dependency (Group A).
#RerankerCutoverPlan: {
	commandId:  shared.#CommandId
	slot:       shared.#Slot & "reranker"
	casToken:   shared.#CasToken
	confirmed:  flags.#OperatorConfirmed
	validated:  flags.#CandidateValidated
}

// RerankerActivationResult is the honest activation outcome: activated invalidates the rerank cache/eval version with reEmbedded false, else a typed gate refusal (Group A).
#RerankerActivationResult: {
	gate:                     enums.#CutoverGate
	invalidatedBindingVersion?: shared.#BindingVersion
	reEmbedded:               flags.#ReEmbedded
	reason?:                  shared.#ReasonText
}

// RerankerRollbackPlan is the mutation plan a reranker rollback dispatches; it targets an archived superseded prior, never a fabricated version (Group A).
#RerankerRollbackPlan: {
	commandId:      shared.#CommandId
	slot:           shared.#Slot & "reranker"
	targetVersion:  shared.#BindingVersion
	casToken:       shared.#CasToken
	confirmed:      flags.#OperatorConfirmed
}
