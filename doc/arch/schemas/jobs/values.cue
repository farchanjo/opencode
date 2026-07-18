// DDD role: ValueObject
// Package: jobs.shared
// Ordering, version, budget and lag counter ValueObjects for the scheduled-jobs
// engine. Sequence/attempt/generation authority belongs to the canonical
// Feature 002 executor; these are the typed carriers, not a second authority (C6).

package jobs.shared

// Sequence is per-aggregate ordering; no global order is implied (FR10, FR12).
#Sequence: uint & >=0

// Attempt is the 1-based attempt index owned by the Feature 002 executor (C6).
#Attempt: uint & >=1

// Generation is the fencing generation carried in the idempotency tuple (C6).
#Generation: uint & >=0

// SchemaVersion mirrors the EventV2 durable.version counter (C8).
#SchemaVersion: uint & >=1

// Version is the Job Definition CAS/optimistic-concurrency version (FR2, FR6).
#Version: uint & >=1

// DeadlineMs bounds an occurrence deadline; provisional constant with hook AC12.
#DeadlineMs: uint & >=0

// TimeoutMs bounds an occurrence execution timeout; provisional constant with hook AC12.
#TimeoutMs: uint & >=0

// RetryBudget bounds retry/fallback attempts; no blind retry of mutations (FR14, C11).
#RetryBudget: uint & >=0

// Priority orders admission/fairness for a definition (FR18).
#Priority: uint & >=0

// ScheduleLagMs is lag measured from nominal due time (FR19, AC3, AC4).
#ScheduleLagMs: uint & >=0
