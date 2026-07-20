// DDD role: ValueObject
// Package: executor_composition.shared
// Bounded identity ValueObjects for the Feature 018 executor composition — the
// definition/occurrence/session/process keys the scheduler, coordinator, run-now
// enqueue, occurrence projection, and interrupt edge target. Each id is a named
// type so no primitive is carried inline (wrap-primitives); none holds content —
// a prompt, transcript, or spool page body never crosses these seams. Shares the
// executor_composition.shared package with shared.cue (the operator-capability-gaps
// corpus precedent of splitting a package across focused files).

package executor_composition.shared

// JobDefinitionId is the definition key the executor schedules and the occurrence projection reads history by (FR8).
#JobDefinitionId: string & !~"^$"

// OccurrenceId is the content-free identity of one claimed occurrence the coordinator runs and run-now enqueues (FR4, FR7).
#OccurrenceId: string & !~"^$"

// RootSessionId is the root-session aggregate key of the occurrence tree and the forced-abort interrupt target (FR8, FR9).
#RootSessionId: string & !~"^$"

// RootKey is the SessionRunCoordinator interrupt key the second-press forced abort targets through the narrow registry (FR9, FR10).
#RootKey: string & !~"^$"

// ProcessId is the canonical Feature 002 Task Process identity the coordinator creates for a scheduled occurrence (FR4).
#ProcessId: string & !~"^$"
