// DDD role: ValueObject
// Package: orchestration
// Feature 044 — shared identifier and scalar ValueObjects for the hierarchy
// orchestration contract. Centralised here to avoid primitive obsession and
// duplicated constraints across the four leaves (aggregate / gate / chain / wake).

package orchestration

// SessionId identifies a Session across the delegation correlation chain (FR-A1).
// DDD role: ValueObject
#SessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// TodoRef is the deterministic reference to a session-owned Todo aggregate.
// DDD role: ValueObject
#TodoRef: string & !~"^$"

// TodoVersion is the content-hash version token of a Todo aggregate (CAS).
// DDD role: ValueObject
#TodoVersion: string & !~"^$"

// FailureReason is a bounded, non-secret explanation for a failed/aborted Worker.
// DDD role: ValueObject
#FailureReason: string & =~"^.{1,256}$"

// Count is a non-negative roll-up counter.
// DDD role: ValueObject
#Count: uint & >=0

// MaxWaitMs bounds how long the Manager waits on a single Worker before it is
// force-aborted with a timeout (FR-D3) — an operator-tunable plan constant.
// DDD role: ValueObject
#MaxWaitMs: uint & >=1
