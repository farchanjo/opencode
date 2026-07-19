// DDD role: ValueObject
// Package: mcp.shared
// Bounded content-classified text ValueObjects. Every axis is sanitized metadata,
// classification or a bounded label — never a secret, full tool/resource body, prompt,
// reasoning trace, or filesystem path (FR34, FR56, C16, C26). A provenance label marks
// untrusted external content at the context boundary (FR27, C24); redacted text is a
// bounded, secret-stripped log/metadata slice (FR28, C23). A cursor is an opaque
// pagination token, never decoded content (FR10, C4).

package mcp.shared

// ServerName is a bounded human-facing MCP server name; classification, not content (FR48).
#ServerName: string & !~"^$"

// ProtocolVersion is the negotiated MCP protocol version string, e.g. 2025-11-25 (FR7, C2).
#ProtocolVersion: string & !~"^$"

// Reason is a bounded typed explanation on a record or event; never free-form content (FR7, C2).
#Reason: string

// DisplayLabel is a bounded UI label shown on a server/tool/resource card (FR57).
#DisplayLabel: string & !~"^$"

// Cursor is the opaque tools/list pagination cursor token; never decoded content (FR10, C4).
#Cursor: string & !~"^$"

// ProvenanceLabel marks untrusted external MCP content at the context boundary (FR27, C24).
#ProvenanceLabel: string & !~"^$"

// Title is a bounded human title on a tool/resource/prompt descriptor (FR12, FR57).
#Title: string

// RedactedText is a bounded secret-stripped log/metadata slice; no secrets or paths (FR28, C23).
#RedactedText: string

// Timestamp is an ISO 8601 instant; observational timestamps decode via DateTimeUtcFromMillis in TS.
#Timestamp: string & !~"^$"
