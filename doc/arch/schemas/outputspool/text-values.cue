// DDD role: ValueObject
// Package: outputspool.shared
// Bounded content-classified text, flag and timestamp ValueObjects. Every text
// axis excludes raw file text, diffs, prompts, messages, spool paths, snippets and
// secrets (FR5, FR12, FR33, Security 5, C22). A language tag is provenance metadata
// carried on a textual channel per Feature 004, never re-computed content (FR40, C8).

package outputspool.shared

// ContentType is the bounded media type of a channel; classification, not content (FR16).
#ContentType: string & !~"^$"

// IntegrityTag is the opaque cursor/seal integrity tag; codec is a plan constant (FR17, C14, C18).
#IntegrityTag: string & !~"^$"

// LanguageTag is a canonical BCP 47 provenance tag on a textual channel (FR40, C8).
#LanguageTag: string & =~"^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$"

// Timestamp is an ISO 8601 instant; observational timestamps decode via DateTimeUtcFromMillis in TS.
#Timestamp: string & !~"^$"

// TraceId correlates an output.* span; lives in traces/logs only, never a metric label (C22).
#TraceId: string & !~"^$"

// SpanId correlates an output.* span; lives in traces/logs only, never a metric label (C22).
#SpanId: string & !~"^$"

// Reason is a bounded human-readable explanation on a record or event; no content (Security 5).
#Reason: string

// CaughtUp signals an open-stream reader has consumed through committed end without eof (FR21).
#CaughtUp: bool

// Eof is true only when the channel is sealed or aborted and consumed through committed end (FR21, C20).
#Eof: bool

// Disposable marks a channel eligible for OS-tmp with no recovery guarantee (FR11, C2).
#Disposable: bool
