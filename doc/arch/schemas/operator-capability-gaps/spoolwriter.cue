// DDD role: ValueObject
// Package: operator_capability_gaps.spoolwriter
// The OutputSpool production writer + admin edge contract (Feature 017, GAP A —
// the headline). A production writer subscribed at the session message-part seam
// drives createChannelWriter per channel generation, writing to the SAME
// control-store the operator reads, so output.stat/read/follow reflect real
// session output; the writer honors the Feature 005 producer ownership (C21),
// content-free events (C22), bounded memory, and stale-generation fencing
// (FR6-FR10). The release/delete/purge admin edge commits through a store-scoped
// authority — the settled token is the control-store generation, NOT a config CAS
// version — preserving the audit and no-phantom-write invariants (FR9). CUE
// packages are not cross-resolved by the structural reader; import paths mirror
// the operator-persistence corpus style.

package operator_capability_gaps.spoolwriter

import (
	"operator-capability-gaps/enums"
	"operator-capability-gaps/shared"
	"operator-capability-gaps/flags"
)

// SpoolWriterBinding is one production writer bound to a channel generation at the session message-part seam; the generation fences a stale writer (FR6, FR10).
#SpoolWriterBinding: {
	outputRef:  shared.#OutputRef
	generation: shared.#ChannelGeneration
	phase:      enums.#WriterPhase
	populated:  flags.#SpoolPopulated
}

// SpoolReadResult is a stat/read/follow outcome over the populated control store, or the typed unavailable gap when unbound (FR7, FR8).
#SpoolReadResult: {
	outputRef: shared.#OutputRef
	readiness: enums.#BackendReadiness
	gap?:      enums.#ServiceGap
	reason?:   shared.#ReasonText
}

// SpoolAdminEdge is a release/delete/purge op committing through the store-scoped authority via the mutation_plan contract; the version is a control-store generation (FR9).
#SpoolAdminEdge: {
	commandId: shared.#CommandId
	authority: shared.#AuthorityKey
	outputRef: shared.#OutputRef
	version?:  shared.#Version
	reason?:   shared.#ReasonText
}
