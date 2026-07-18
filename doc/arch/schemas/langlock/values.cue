// DDD role: ValueObject
// Package: langlock.shared
// Version and bounded-count ValueObjects for the Lang Lock engine. Versions are
// carried, not re-authored: the Feature 007 Config.Service authority owns the CAS
// policy version and EventV2 owns the durable schema version (C2, C8).

package langlock.shared

// PolicyVersion is the Config.Service CAS/optimistic-concurrency version of a policy (FR5, FR7).
#PolicyVersion: uint & >=1

// ConfigVersion is the config-document version captured into an execution envelope at start (FR7, C11).
#ConfigVersion: uint & >=1

// SchemaVersion mirrors the EventV2 durable.version counter (C8).
#SchemaVersion: uint & >=1

// Sequence is per-aggregate ordering for a durable langlock.* event; no global order is implied (C8).
#Sequence: uint & >=0

// AdvisoryCount is a bounded advisory-violation count exported as a metric value (Observability, AC14).
#AdvisoryCount: uint & >=0

// ExceptionCount is a bounded count of matched exception entries exported as a metric value (Observability, AC14).
#ExceptionCount: uint & >=0
