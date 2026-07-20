// DDD role: ValueObject
//
// Feature 024 — Implement routing configure persistence so operator routing.
// Models the routing.configure mutation-plan path that makes the TUI "Routing
// configure" Save persist through the single mutateAuthority CAS write, and the
// shared-authority partial-merge that preserves role_pools (pools.set) and
// activation (smart.*) on the same `routing` document.
//
// Anchors (verified 2026-07-20):
//   - inbound mutation-plan path (was not_implemented):
//       packages/opencode/src/routing/adapters/inbound/routing-command-port.ts:190
//   - write-capable configure backend (mirror smart/pools):
//       packages/opencode/src/routing/adapters/outbound/configure-backend.ts:105
//   - partial-merge in apply(current):
//       packages/opencode/src/routing/adapters/outbound/configure-backend.ts:92,137
//   - routing-module authority SSOT:
//       packages/opencode/src/routing/adapters/outbound/config-adapter.ts:31
//   - live-stack wiring:
//       packages/opencode/src/operator/stack-live.ts:818
//   - single committed CAS write (mutateAuthority.apply(current)):
//       packages/opencode/src/operator/application/mutation.ts:277-296

package schemas

// A Config authority key the routing document commits to (scope-independent
// "routing" for the project document; "global:routing" for the global scope).
#RoutingAuthorityKey: "routing" | "global:routing"

// The routing mode an operator may set on the "Routing configure" form.
#RoutingConfigureMode: "always" | "auto" | "never"

// The parsed, content-free routing.configure payload (FR-B). Defaults mirror the
// disabled/never safe default; the inbound adapter rejects an all-empty payload.
// DDD role: ValueObject
#RoutingConfigureInput: {
	// The Enabled toggle -> activation.enabled.
	enabled: bool | *false
	// The Auto/Always/Never picker -> activation.mode.
	mode: #RoutingConfigureMode | *"never"
	// The advanced {"budgetPolicy":{…}} override -> enforcement.budget. Validated
	// against RoutingConfig.Info at plan time; a malformed shape is invalid_argument.
	hasBudgetPolicy: bool | *false
}

// How the inbound adapter resolves routing.configure (FR-A, FR-B): a validated
// plan when a backend is wired; not_implemented for a read-only port; or a typed
// invalid_argument for a bad mode / malformed policy / empty payload.
#RoutingConfigureResolution: "mutation_plan" | "not_implemented" | "invalid_argument"

// The partial-merge-under-CAS contract (FR-C). apply(current) reads the FRESH
// persisted payload and merges ONLY the configure-owned fields
// (activation.enabled/mode + enforcement.budget) into it, preserving the siblings
// role_pools (pools.set) and activation (smart.*); the backend never self-commits.
// DDD role: ValueObject
#PartialMergeUnderCas: {
	authority: #RoutingAuthorityKey
	// apply reads the commit-time on-disk payload, not a plan-time snapshot.
	mergesFreshPayload: true
	// Sibling keys owned by pools.set / smart.* are left untouched.
	preservesSiblings: true
	// The dispatcher's single mutateAuthority CAS write owns the commit.
	selfCommits:          false
	singleCommittedWrite: true
}

// The end-to-end routing.configure save contract. The `guard` block is the
// optimistic-concurrency contract (FR-D), PRESERVED verbatim: no self-commit and
// no auto-resolved token; a stale expected-version is a conflict. A rejected Save
// is surfaced to the TUI, never a silent success or a silent sibling clobber.
// DDD role: ValueObject
#RoutingConfigureSave: {
	input:      #RoutingConfigureInput
	resolution: #RoutingConfigureResolution
	merge:      #PartialMergeUnderCas
	guard: {
		requiresVersionWhenConfigured: true
		rejectsStaleToken:             true
		autoResolvesMissingToken:      false
		defaultsAbsentVersion:         false
	}
	outcome:        "persisted" | "rejected_surfaced"
	surfacedToUser: bool | *false
	if outcome == "rejected_surfaced" {
		surfacedToUser: true
	}
}

// The reproduced regression scenarios (FR-E), proven over the REAL wired dispatcher.
#ReproducedScenario:
	"save_persists_activation_mode_policy_and_bumps_version" |
	"coexistence_pools_smart_routing_none_clobber_on_disk" |
	"invalid_policy_typed_error_nothing_committed" |
	"stale_version_conflict_nothing_committed"

// First-class collection: the proven-scenario set (at least one), isolated so the
// aggregate mixes no bare inline collection with scalar fields.
#ReproducedScenarioSet: [...#ReproducedScenario] & [_, ...]

// DDD role: ValueObject
#ImplementRoutingConfigurePersistenceSoOperatorRouting: {
	save:  #RoutingConfigureSave
	proof: #ReproducedScenarioSet
	// Cross-cutting invariants: no operator payload/command-id/catalog-version/
	// dispatch/parallel-store change, and the single-committed-CAS-write guard is
	// preserved verbatim (FR-D, NFR).
	invariants: {
		contractUnchanged:    true
		noParallelStore:      true
		singleCommittedWrite: true
	}
}
