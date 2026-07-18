// DDD role: ValueObject
// Package: semantic.shared
// Bounded content-classified text ValueObjects. Every axis is sanitized metadata,
// never a secret, full prompt, reasoning trace, private payload, or filesystem path
// (FR17, C4). A language tag is a BCP 47 provenance tag preserving the original query
// language for embedding without a mandatory translation LLM call (FR14, FR15, FR16).
// A degraded reason is a bounded typed explanation, never free-form content (FR24, C20).

package semantic.shared

// Name is a bounded human-facing provider/model/skill name; classification, not content (FR28).
#Name: string & !~"^$"

// DisplayName is a bounded human-facing label shown in the operator panel (FR29).
#DisplayName: string & !~"^$"

// Description is a bounded sanitized description; a ranking signal only, never authority (FR10, FR36).
#Description: string

// BaseUrl is a bounded provider endpoint URL parsed under the SSRF-safe policy (FR33, C17).
#BaseUrl: string & !~"^$"

// LanguageTag is a canonical BCP 47 provenance tag (pt-BR/es/en initial locales) (FR14, FR16).
#LanguageTag: string & =~"^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$"

// Tag is a bounded taxonomy token for a domain, capability, trigger, tool, or role (FR10, FR11).
#Tag: string & !~"^$"

// ModeTag is the bounded agent mode carried on an AgentDoc projection (FR10).
#ModeTag: string & !~"^$"

// DegradedReason is the bounded typed reason recorded when retrieval degrades (FR24, C20, AC29).
#DegradedReason: string & !~"^$"

// Timestamp is an ISO 8601 instant; observational timestamps decode via DateTimeUtcFromMillis in TS.
#Timestamp: string & !~"^$"

// Reason is a bounded human-readable explanation on a record or event; no content (FR22).
#Reason: string
