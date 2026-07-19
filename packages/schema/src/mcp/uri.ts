export * as Uri from "./uri"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/mcp/uri.cue one-to-one. URI, scheme and media-type
// ValueObjects for the resource content plane. A resource URI and template are
// bounded opaque references scoped to the negotiated roots; the scheme allowlist is
// https plus server-declared URIs, file only within authorized roots, every other
// scheme deny-by-default (FR25, C12). A MIME type gates decode-to-spool under the
// allowlist and size caps (FR36, C17). No axis inlines content and no file URI
// escapes an authorized root (FR34, C12, C16).
//
// Same base-then-annotate-then-check discipline as ./ids (contract hygiene).

// ResourceUri is a bounded resource URI scoped to the negotiated roots; never inlined content (FR25, C12).
export const ResourceUri = Schema.String.annotate({ identifier: "McpUri.ResourceUri" }).check(Schema.isNonEmpty())
export type ResourceUri = typeof ResourceUri.Type

// ResourceTemplateUri is a bounded RFC 6570 resource-template URI under root scope (FR19, C12).
export const ResourceTemplateUri = Schema.String.annotate({ identifier: "McpUri.ResourceTemplateUri" }).check(
  Schema.isNonEmpty(),
)
export type ResourceTemplateUri = typeof ResourceTemplateUri.Type

// UriScheme is a lower-case URI scheme token gated by the allowlist; https default (FR25, C12).
export const UriScheme = Schema.String.annotate({ identifier: "McpUri.UriScheme" }).check(
  Schema.isPattern(/^[a-z][a-z0-9+.-]*$/),
)
export type UriScheme = typeof UriScheme.Type

// RootUri is a bounded negotiated project/session root; no path overexposure beyond it (FR9, C12).
export const RootUri = Schema.String.annotate({ identifier: "McpUri.RootUri" }).check(Schema.isNonEmpty())
export type RootUri = typeof RootUri.Type

// MimeType is a bounded media type gating decode-to-spool under the MIME allowlist (FR36, C17).
export const MimeType = Schema.String.annotate({ identifier: "McpUri.MimeType" }).check(
  Schema.isPattern(/^[a-zA-Z0-9!#$&^_.+-]{1,127}\/[a-zA-Z0-9!#$&^_.+-]{1,127}$/),
)
export type MimeType = typeof MimeType.Type
