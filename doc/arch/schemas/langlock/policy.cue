// DDD role: AggregateRoot
// Package: langlock.policy
// LangLockPolicy — the durable policy aggregate persisted in the Feature 007
// Config.Service authority (FR5, C2). Global configuration is the base authority;
// a project override applies only when langlock.override is authorized and never
// relaxes the global hard-policy floor (FR5, Security 1). No parallel store is
// introduced; cohesive parts live in policy-parts.cue.

package langlock.policy

import "langlock/ids"

// LangLockPolicy is the aggregate root of a Lang Lock policy; id is the policy_id (FR5, C2).
#LangLockPolicy: {
	id: ids.#PolicyId

	// Owning principal, CAS version and lifecycle timestamps.
	identity: #PolicyIdentity

	// Enabled flag, canonical tag, display name and enforcement mode.
	language: #PolicyLanguage

	// Scope, origin, hard floor, override authorization and bound project/manifest refs.
	authority: #PolicyAuthority
}
