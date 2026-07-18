// DDD role: ValueObject
// Package: langlock.events
// Durable audit event members (C8). Policy-mutation, override and exception events
// are durable and never coalesced or dropped; they replay through readAggregate
// (FR34, C8). Administration is native operator-only via Feature 007; no LLM ever
// authors these (FR35, Security 4, AC13). Audit is content-free (Security 5).

package langlock.events

import "langlock/envelope"

// policy_set — a durable policy was set under CAS through Feature 007 (FR34, C3).
#LangLockPolicySetEvent: {
	type:     "langlock.policy_set"
	envelope: envelope.#LangLockEnvelope
	detail:   #PolicyDetail
}

// policy_reset — a policy was reset to the global/default under CAS (FR34, C3).
#LangLockPolicyResetEvent: {
	type:     "langlock.policy_reset"
	envelope: envelope.#LangLockEnvelope
	detail:   #PolicyDetail
}

// override_authorized — a project override was authorized under langlock.override (FR5, Security 1, AC6).
#LangLockOverrideAuthorizedEvent: {
	type:     "langlock.override_authorized"
	envelope: envelope.#LangLockEnvelope
	detail:   #OverrideDetail
}

// override_denied — a project override was denied and the global value retained (FR5, AC5).
#LangLockOverrideDeniedEvent: {
	type:     "langlock.override_denied"
	envelope: envelope.#LangLockEnvelope
	detail:   #OverrideDetail
}

// exception_registered — an operator registered a schema-validated exemption (FR14, C16, AC9).
#LangLockExceptionRegisteredEvent: {
	type:     "langlock.exception_registered"
	envelope: envelope.#LangLockEnvelope
	detail:   #ExceptionDetail
}

// exception_revoked — an operator revoked an exemption (FR14, C16).
#LangLockExceptionRevokedEvent: {
	type:     "langlock.exception_revoked"
	envelope: envelope.#LangLockEnvelope
	detail:   #ExceptionDetail
}
