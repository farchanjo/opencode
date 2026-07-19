export * as TextValues from "./text-values"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/mcp/text-values.cue one-to-one. Bounded
// content-classified text ValueObjects: every axis is sanitized metadata,
// classification or a bounded label — never a secret, full tool/resource body,
// prompt, reasoning trace, or filesystem path (FR34, FR56, C16, C26). A provenance
// label marks untrusted external content at the context boundary (FR27, C24);
// redacted text is a bounded, secret-stripped log/metadata slice (FR28, C23); a
// cursor is an opaque pagination token, never decoded content (FR10, C4).
//
// Same base-then-annotate-then-check discipline as ./ids: the root identifier is
// annotated on the plain base BEFORE any check (contract hygiene).

// ServerName is a bounded human-facing MCP server name; classification, not content (FR48).
export const ServerName = Schema.String.annotate({ identifier: "McpText.ServerName" }).check(Schema.isNonEmpty())
export type ServerName = typeof ServerName.Type

// ProtocolVersion is the negotiated MCP protocol version string, e.g. 2025-11-25 (FR7, C2).
export const ProtocolVersion = Schema.String.annotate({ identifier: "McpText.ProtocolVersion" }).check(
  Schema.isNonEmpty(),
)
export type ProtocolVersion = typeof ProtocolVersion.Type

// Reason is a bounded typed explanation on a record or event; never free-form content (FR7, C2).
export const Reason = Schema.String.annotate({ identifier: "McpText.Reason" })
export type Reason = typeof Reason.Type

// DisplayLabel is a bounded UI label shown on a server/tool/resource card (FR57).
export const DisplayLabel = Schema.String.annotate({ identifier: "McpText.DisplayLabel" }).check(Schema.isNonEmpty())
export type DisplayLabel = typeof DisplayLabel.Type

// Cursor is the opaque tools/list pagination cursor token; never decoded content (FR10, C4).
export const Cursor = Schema.String.annotate({ identifier: "McpText.Cursor" }).check(Schema.isNonEmpty())
export type Cursor = typeof Cursor.Type

// ProvenanceLabel marks untrusted external MCP content at the context boundary (FR27, C24).
export const ProvenanceLabel = Schema.String.annotate({ identifier: "McpText.ProvenanceLabel" }).check(
  Schema.isNonEmpty(),
)
export type ProvenanceLabel = typeof ProvenanceLabel.Type

// Title is a bounded human title on a tool/resource/prompt descriptor (FR12, FR57).
export const Title = Schema.String.annotate({ identifier: "McpText.Title" })
export type Title = typeof Title.Type

// RedactedText is a bounded secret-stripped log/metadata slice; no secrets or paths (FR28, C23).
export const RedactedText = Schema.String.annotate({ identifier: "McpText.RedactedText" })
export type RedactedText = typeof RedactedText.Type

// Timestamp is an ISO 8601 instant; observational timestamps decode via DateTimeUtcFromMillis in TS.
export const Timestamp = Schema.String.annotate({ identifier: "McpText.Timestamp" }).check(Schema.isNonEmpty())
export type Timestamp = typeof Timestamp.Type
