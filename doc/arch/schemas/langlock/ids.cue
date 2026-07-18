// DDD role: ValueObject
// Package: langlock.shared
// Shared identity ValueObjects for the Feature 004 Lang Lock engine. Centralised
// to avoid primitive obsession and duplicated constraints. Name parity with the
// operator/lifecycle shared identifiers is intentional; CUE packages are not
// cross-imported here, so the identifier concepts are re-declared locally
// (Feature 004 C2, C8).

package langlock.shared

// LanguageTag is a canonical BCP 47 tag validated by Intl.getCanonicalLocales plus the allowlist (FR1, FR4).
#LanguageTag: string & =~"^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$"

// PolicyId identifies one durable Lang Lock policy record in the Config.Service authority (FR5, C2).
#PolicyId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ExceptionId identifies one operator-owned exception-manifest entry (FR14, C16).
#ExceptionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ExecutionId is the opaque execution correlation id; it is never used as a metric label (Observability, C8).
#ExecutionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// EventId is the EventV2 evt_ identifier assigned per published langlock.* event (C8).
#EventId: string & =~"^evt_[A-Za-z0-9_-]{1,120}$"
