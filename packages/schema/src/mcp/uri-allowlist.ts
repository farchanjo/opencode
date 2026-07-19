export * as Allowlist from "./uri-allowlist"

import { Schema } from "effect"
import { Collections } from "./collections"
import { Policy } from "./policy"
import { Values } from "./values"

// Mirrors the allowlist ValueObjects of doc/arch/schemas/mcp/content.cue one-to-one.
// The resource URI allowlist is https plus roots-scoped server URIs, `file` only
// within authorized project/session roots, every other scheme deny-by-default (FR25,
// C12); the MIME allowlist plus byte cap gate decode-to-spool and reject
// decompression bombs before delivery (FR36, C17, C24). Neither descriptor inlines
// content or a filesystem path (FR34, C16).

// UriAllowlist is the resource URI allowlist: https plus roots-scoped URIs, file within roots (FR25, C12).
export const UriAllowlist = Schema.Struct({
  schemes: Collections.SchemeSet,
  roots: Collections.RootUriList,
  allow_file_in_roots: Policy.Enabled,
}).annotate({ identifier: "McpAllowlist.UriAllowlist" })
export type UriAllowlist = Schema.Schema.Type<typeof UriAllowlist>

// MimeAllowlist is the MIME allowlist and byte cap gating decode-to-spool (FR36, C17).
export const MimeAllowlist = Schema.Struct({
  types: Collections.MimeTypeSet,
  max_bytes: Values.ByteLength,
}).annotate({ identifier: "McpAllowlist.MimeAllowlist" })
export type MimeAllowlist = Schema.Schema.Type<typeof MimeAllowlist>
