// DDD role: ValueObject
// Package: langlock.shared
// Correlation, principal and reference ValueObjects. All reference axes carry
// opaque handles only; Feature 005 owns output bytes and Feature 002 owns Todo
// content (FR28, FR30, Security 5, C9, C10).

package langlock.shared

// CorrelationId groups related langlock.* events across one logical execution (C8).
#CorrelationId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// CausationId references the event that directly caused this one (C8).
#CausationId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// Principal is the operator/system principal that owns or acts on a policy (Security 1, Security 4).
#Principal: string & !~"^$"

// ProjectRef references the project scope a policy override is bound to (FR5, C2).
#ProjectRef: string & !~"^$"

// RootSessionId references the authorized root-session tree carrying the effective lock (FR26, C11).
#RootSessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// SessionId references the session an execution envelope belongs to (FR26, C11).
#SessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// TodoRef references the Feature 002 session-owned Todo whose text follows the lock (FR28, C10).
#TodoRef: string & !~"^$"

// OutputRef is a bounded opaque Feature 005 reference; Feature 005 owns bytes and provenance (FR30, C9).
#OutputRef: string & !~"^$"

// ManifestRef references the operator-owned exception manifest a policy binds (FR14, C16).
#ManifestRef: string & !~"^$"
