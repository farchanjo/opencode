// DDD role: ValueObject
// Package: langlock.events
// Live enforcement and advisory event members (C8). Injection, reapply, stamping,
// advisory detection and resolution events are live (no durable sequence) and never
// gate the write (FR17, FR21, C4, C6). Advisory records are content-free: bounded
// enums/buckets only, no file text, diff, prompt, path or snippet (Security 5, AC14).

package langlock.events

import "langlock/envelope"

// policy_injected — the effective language was injected into a V1/V2 system prompt (FR17, C4, AC7).
#LangLockPolicyInjectedEvent: {
	type:     "langlock.policy_injected"
	envelope: envelope.#LangLockEnvelope
	detail:   #InjectionDetail
}

// policy_reapplied — the lock was reapplied after experimental.chat.system.transform (FR25, C4, AC7).
#LangLockPolicyReappliedEvent: {
	type:     "langlock.policy_reapplied"
	envelope: envelope.#LangLockEnvelope
	detail:   #InjectionDetail
}

// envelope_stamped — tag/version/source/mode were stamped onto an execution envelope (FR18, C4, AC4).
#LangLockEnvelopeStampedEvent: {
	type:     "langlock.envelope_stamped"
	envelope: envelope.#LangLockEnvelope
	detail:   #InjectionDetail
}

// advisory_flagged — advisory detection flagged a language mismatch on classified prose (FR21, C5, C6, AC8).
#LangLockAdvisoryFlaggedEvent: {
	type:     "langlock.advisory_flagged"
	envelope: envelope.#LangLockEnvelope
	detail:   #AdvisoryDetail
}

// advisory_acknowledged — an operator acknowledged a flagged advisory (FR21, C6, AC8).
#LangLockAdvisoryAcknowledgedEvent: {
	type:     "langlock.advisory_acknowledged"
	envelope: envelope.#LangLockEnvelope
	detail:   #AdvisoryDetail
}

// advisory_suppressed — an operator suppressed a repeat advisory warning (FR21, C6, AC8).
#LangLockAdvisorySuppressedEvent: {
	type:     "langlock.advisory_suppressed"
	envelope: envelope.#LangLockEnvelope
	detail:   #AdvisoryDetail
}

// detector_unknown — the advisory detector returned unknown/failure; never blocks a hot path (FR21, C5).
#LangLockDetectorUnknownEvent: {
	type:     "langlock.detector_unknown"
	envelope: envelope.#LangLockEnvelope
	detail:   #AdvisoryDetail
}

// resolution_retained — a project override was not applied and the global value was retained (FR5, C2, AC5).
#LangLockResolutionRetainedEvent: {
	type:     "langlock.resolution_retained"
	envelope: envelope.#LangLockEnvelope
	detail:   #ResolutionDetail
}

// unknown — an out-of-band or unrecognized langlock.* signal; envelope-only, never gates work (C8).
#LangLockUnknownEvent: {
	type:     "langlock.unknown"
	envelope: envelope.#LangLockEnvelope
}
