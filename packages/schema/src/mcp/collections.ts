export * as Collections from "./collections"

import { Schema } from "effect"
import { Ids } from "./ids"
import { Refs } from "./refs"
import { Uri } from "./uri"

// Mirrors doc/arch/schemas/mcp/collections.cue one-to-one. First-class collection
// ValueObjects replacing bare arrays across profiles, allowlists and catalogs
// (calisthenics). Each wraps a shared ValueObject element so a header-ref set, scheme
// set, root list, MIME set or tool-name set carries one named type rather than an
// anonymous list. A header-ref set holds Feature 007 secure refs, never inline secrets
// (FR32, C15); a root list holds negotiated roots, never arbitrary paths (FR9, C12);
// no element is content.

// HeaderRefSet is a first-class collection of secure outbound header refs (FR32, C15).
export const HeaderRefSet = Schema.Array(Refs.HeaderRef).annotate({ identifier: "McpCollections.HeaderRefSet" })
export type HeaderRefSet = typeof HeaderRefSet.Type

// SchemeSet is the first-class allowlist of permitted URI schemes; https default (FR25, C12).
export const SchemeSet = Schema.Array(Uri.UriScheme).annotate({ identifier: "McpCollections.SchemeSet" })
export type SchemeSet = typeof SchemeSet.Type

// RootUriList is the first-class collection of negotiated project/session roots (FR9, C12).
export const RootUriList = Schema.Array(Uri.RootUri).annotate({ identifier: "McpCollections.RootUriList" })
export type RootUriList = typeof RootUriList.Type

// MimeTypeSet is the first-class MIME allowlist gating decode-to-spool (FR36, C17).
export const MimeTypeSet = Schema.Array(Uri.MimeType).annotate({ identifier: "McpCollections.MimeTypeSet" })
export type MimeTypeSet = typeof MimeTypeSet.Type

// ToolNameList is the first-class collection of tool names on a catalog page (FR10, C4).
export const ToolNameList = Schema.Array(Ids.ToolName).annotate({ identifier: "McpCollections.ToolNameList" })
export type ToolNameList = typeof ToolNameList.Type

// SecretRefList is the first-class collection of SecretRefs redacted out of a preview (FR32, C15).
export const SecretRefList = Schema.Array(Refs.SecretRef).annotate({ identifier: "McpCollections.SecretRefList" })
export type SecretRefList = typeof SecretRefList.Type
