// DDD role: ValueObject
// Package: jobs.shared
// Correlation, principal and secure-reference ValueObjects. All reference axes
// carry opaque handles only; secrets are never raw values (Security 3, C10).

package jobs.shared

// CorrelationId groups related job.* events across a logical occurrence (FR12).
#CorrelationId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// CausationId references the event that directly caused this one (FR12).
#CausationId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// DecisionId references a Feature 001 routing.decision — parity id (C11).
#DecisionId: string & =~"^[0-9A-HJKMNP-TV-Z]{26}$"

// TurnId references a single turn within a Session — parity id.
#TurnId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// Principal is the operator/system principal that owns or acts on a definition (C10, C12).
#Principal: string & !~"^$"

// SecretRef is an OS-keychain-backed secure reference — never a raw secret (Security 3, C10).
#SecretRef: string & !~"^$"

// PayloadRef is a redacted payload reference; large content stays out of band (FR22, Privacy).
#PayloadRef: string & !~"^$"

// OutputRef is a bounded opaque Feature 005 reference; Feature 005 owns bytes (FR8a, FR22, C15).
#OutputRef: string & !~"^$"

// ProjectRef references the project scope a definition is bound to (C12).
#ProjectRef: string & !~"^$"

// TodoRef references the occurrence-owned Feature 002 Todo aggregate (FR8, C14).
#TodoRef: string & !~"^$"
