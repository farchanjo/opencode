// DDD role: ValueObject
// Package: langlock.events
// LangLockEvent — the closed tagged union of the langlock.* event members (C8),
// plus the cohesive detail sub-objects distinct members carry. Mirroring
// Feature 002/003, each member is registered as its own EventV2.define Definition
// on the EventV2Bridge via publishLangLockEvent; no raw union is wired to the bus
// (C8). Durable audit members carry the EventV2 durable annotation and replay
// through readAggregate; live advisory members omit it (C8). Members live in
// events-audit.cue and events-advisory.cue.

package langlock.events

import (
	"langlock/ids"
	"langlock/enums"
)

// PolicyDetail carries the tag, scope and CAS version for a policy mutation event (FR34, C8).
#PolicyDetail: {
	tag:            ids.#LanguageTag
	scope:          enums.#Scope
	policy_version: ids.#PolicyVersion
}

// OverrideDetail carries the override authorization outcome, scope and floor state (FR5, Security 1, AC6).
#OverrideDetail: {
	override_authorized: ids.#OverrideAuthorized
	scope:               enums.#Scope
	hard_floor:          ids.#HardFloor
}

// ExceptionDetail carries the exemption category and its authority scope (FR14, C16).
#ExceptionDetail: {
	category: enums.#ExceptionCategory
	scope:    enums.#Scope
}

// InjectionDetail carries the enforcement mode and origin of an injection/reapply/stamp event (FR17, C4).
#InjectionDetail: {
	enforcement_mode: enums.#EnforcementMode
	origin:           enums.#Origin
}

// AdvisoryDetail carries the path kind, confidence bucket and remediation status (FR21, C5, C6).
#AdvisoryDetail: {
	path_kind:   enums.#PathKind
	confidence:  enums.#ConfidenceBucket
	remediation: enums.#RemediationStatus
}

// ResolutionDetail carries the resolved scope and origin of a retained resolution (FR5, C2).
#ResolutionDetail: {
	scope:  enums.#Scope
	origin: enums.#Origin
}

// LangLockEvent is the closed tagged union of every langlock.* event member (C8).
#LangLockEvent: (
	#LangLockPolicySetEvent |
	#LangLockPolicyResetEvent |
	#LangLockOverrideAuthorizedEvent |
	#LangLockOverrideDeniedEvent |
	#LangLockExceptionRegisteredEvent |
	#LangLockExceptionRevokedEvent |
	#LangLockPolicyInjectedEvent |
	#LangLockPolicyReappliedEvent |
	#LangLockEnvelopeStampedEvent |
	#LangLockAdvisoryFlaggedEvent |
	#LangLockAdvisoryAcknowledgedEvent |
	#LangLockAdvisorySuppressedEvent |
	#LangLockDetectorUnknownEvent |
	#LangLockResolutionRetainedEvent |
	#LangLockUnknownEvent
)
