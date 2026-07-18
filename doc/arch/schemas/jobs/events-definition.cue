// DDD role: ValueObject
// Package: jobs.events
// Durable definition-mutation and registration event members (C8). Definition and
// registration events are durable and never coalesced or dropped; they replay
// through readAggregate (FR11, C8). Administration is native-only via Feature 007;
// no LLM ever authors these (FR28, AC17).

package jobs.events

import "jobs/envelope"

// definition_created — a durable Job Definition was created under CAS (FR2, C12).
#JobDefinitionCreatedEvent: {
	type:     "job.definition_created"
	envelope: envelope.#JobEnvelope
	detail:   #DefinitionDetail
}

// definition_updated — a definition was updated under version/CAS (FR6).
#JobDefinitionUpdatedEvent: {
	type:     "job.definition_updated"
	envelope: envelope.#JobEnvelope
	detail:   #DefinitionDetail
}

// definition_enabled — a definition was enabled and eligible for registration (FR6).
#JobDefinitionEnabledEvent: {
	type:     "job.definition_enabled"
	envelope: envelope.#JobEnvelope
	detail:   #DefinitionDetail
}

// definition_disabled — a definition was disabled without a silent kill (FR16, C17).
#JobDefinitionDisabledEvent: {
	type:     "job.definition_disabled"
	envelope: envelope.#JobEnvelope
	detail:   #DefinitionDetail
}

// definition_deleted — a definition was deleted with compensating unregister (FR6, C17).
#JobDefinitionDeletedEvent: {
	type:     "job.definition_deleted"
	envelope: envelope.#JobEnvelope
	detail:   #DefinitionDetail
}

// registered — the external Bun/OS registration effect settled registered (FR6, C5).
#JobRegisteredEvent: {
	type:     "job.registered"
	envelope: envelope.#JobEnvelope
	detail:   #RegistrationDetail
}

// unregistered — the registration was removed via compensation (FR6, C5).
#JobUnregisteredEvent: {
	type:     "job.unregistered"
	envelope: envelope.#JobEnvelope
	detail:   #RegistrationDetail
}

// rescheduled — the schedule changed and re-registration intent was recorded (FR6).
#JobRescheduledEvent: {
	type:     "job.rescheduled"
	envelope: envelope.#JobEnvelope
	detail:   #RegistrationDetail
}
