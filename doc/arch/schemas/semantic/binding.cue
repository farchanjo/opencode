// DDD role: AggregateRoot
// Package: semantic.binding
// SemanticModelBinding — a Feature 006 SSOT aggregate pinning one model to one slot
// (FR28). Its id is the binding_id; the version is immutable and bindings persist
// across sessions, restarts, resume and jobs until an operator changes them via
// Feature 007 (FR31). No LLM/router/agent/plugin/MCP sets, updates, or deletes a
// binding (FR31, C3, C15). The effective embedding dimension/metric is bound to the
// index generation and never mixed (FR12, C12). Parts in binding-parts.cue.

package semantic.binding

import (
	"semantic/ids"
	"semantic/enums"
	"semantic/values"
)

// SemanticModelBinding is the SSOT aggregate root of a pinned slot; id is its binding id (FR28, C12).
#SemanticModelBinding: {
	id: ids.#BindingId

	// The operator-pinned slot this binding fills (FR6, FR28).
	slot: enums.#Slot

	// The immutable binding version (FR31, C12).
	version: values.#BindingVersion

	// Provider ref, model ref and rerank compatibility mode (FR28, FR30).
	refs: #BindingRefs

	// The effective capability contract validated for this slot (FR30, C16).
	capability: #CapabilityContract

	// Selecting operator, selection time and config version/hash (FR28, FR31).
	selection: #BindingSelection

	// Bound index generation, its aliases and generation state (FR12, C12).
	generation: #BindingGeneration
}
