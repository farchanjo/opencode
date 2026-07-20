// DDD role: ValueObject
//
// Feature 021 — Operator config-backed saves must persist reliably and never
// silently zero. Models the preflight-authority resolution that makes a
// config-backed save (the reproduced case: pools.set) persist end-to-end, while
// preserving the optimistic-concurrency (CAS) guard verbatim.
//
// Anchors (verified 2026-07-20):
//   - pools.set commit authority "routing":
//       packages/opencode/src/operator/pools/backend-live.ts:44
//   - wired resolver (SSOT, ADR-0017 fix-round):
//       packages/opencode/src/operator/application/command-authority.ts:76-116
//   - degraded fallback (hardened by FR-A):
//       packages/opencode/src/operator/adapters/outbound/config-status.ts:10-13
//   - CAS guard (preserved verbatim, FR-C):
//       packages/opencode/src/operator/application/mutation.ts:224-242

package schemas

// A Config authority key (opaque string a command commits to). Never a payload or
// secret — the preflight status query returns version + configured flags only.
#OperatorAuthorityKey: string & !=""

// How a command-id maps to the authority it commits to. Scope-independent static
// authorities (pools/telemetry/jobs/semantic/mcp-config verbs/output-admin verbs)
// resolve from ONE domain SSOT; scope-dependent ones require the wired resolver.
#AuthorityResolutionKind: "static_ssot" | "scope_dependent_wired" | "prefix_fallback"

// The preflight authority resolution for a command (FR-A). The hardened fallback
// consults the SAME static SSOT as the wired resolver, so a static-authority
// command resolves correctly even with no resolver threaded.
// DDD role: ValueObject
#PreflightAuthorityResolution: {
	commandId: string & !=""
	// The command-id prefix (the OLD, naive fallback value — kept for the diff).
	idPrefix: string & !=""
	// The authority the command's mutation plan actually commits to.
	commitAuthority: #OperatorAuthorityKey
	kind:            #AuthorityResolutionKind
	// True only when commitAuthority == idPrefix (jobs, semantic, routing-project).
	prefixMatches: bool | *false
	// FR-A invariant: a static-authority command resolves its commit authority even
	// when the full scope-aware resolver is absent (stale/mis-wired port). A
	// scope-dependent authority is resolvable only through the wired resolver.
	resolvedWithoutResolver: bool | *false
	if kind == "scope_dependent_wired" {
		resolvedWithoutResolver: false
	}
	if kind == "static_ssot" {
		resolvedWithoutResolver: true
	}
}

// The reproduced pools.set resolution: prefix "pools" is WRONG; commit authority
// is "routing"; the hardened fallback resolves it without the wired resolver.
#PoolsSetResolution: #PreflightAuthorityResolution & {
	commandId:               "pools.set"
	idPrefix:                "pools"
	commitAuthority:         "routing"
	kind:                    "static_ssot"
	prefixMatches:           false
	resolvedWithoutResolver: true
}

// A config-backed save outcome (FR-D) — a rejected save is surfaced, never a
// silent success and never a silent zeroing.
#SaveOutcome: "persisted" | "rejected_surfaced"

// The end-to-end save contract for a config-backed operator mutation. The `guard`
// block is the optimistic-concurrency contract (FR-C), PRESERVED verbatim: the fix
// is correct preflight authority, NOT an auto-resolved or defaulted token.
// DDD role: ValueObject
#ConfigBackedSave: {
	resolution: #PreflightAuthorityResolution
	guard: {
		// A mutation on an already-configured authority MUST carry a version token,
		// and a stale token MUST be rejected as a conflict (lost-update protection).
		requiresVersionWhenConfigured: true
		rejectsStaleToken:             true
		// The fix MUST NOT auto-resolve a missing token nor default an absent version.
		autoResolvesMissingToken: false
		defaultsAbsentVersion:    false
	}
	outcome: #SaveOutcome
	// FR-D: a rejected outcome MUST be surfaced to the user (in-modal / toast); a
	// success closes the form / fires onSaved.
	surfacedToUser: bool | *false
	if outcome == "rejected_surfaced" {
		surfacedToUser: true
	}
}

// The reproduced regression scenarios (FR-E), proven over the REAL wired stack.
#ReproducedScenario:
	"second_pools_set_persists" |
	"first_pools_set_over_existing_routing_doc_persists" |
	"degraded_fallback_resolves_routing_without_resolver" |
	"rejected_mutation_surfaced_in_modal"

// First-class collection: the proven-scenario set (at least one), isolated so the
// aggregate mixes no bare collection with scalar fields.
#ReproducedScenarioSet: [...#ReproducedScenario] & [_, ...]

// DDD role: ValueObject
#OperatorConfigBackedSavesMustPersistReliablyAndNever: {
	save:  #ConfigBackedSave
	proof: #ReproducedScenarioSet
	// Cross-cutting invariants: no operator payload/command-id/catalog-version/
	// dispatch change, and the CAS guard is preserved verbatim (FR-C).
	invariants: {
		contractUnchanged: true
		casGuardPreserved: true
	}
}
