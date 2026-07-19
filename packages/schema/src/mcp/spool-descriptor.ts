export * as SpoolDescriptor from "./spool-descriptor"

import { Schema } from "effect"
import { Collections } from "./collections"
import { Enums } from "./enums"
import { EnumsState } from "./enums-state"
import { Ids } from "./ids"
import { Refs } from "./refs"
import { TextValues } from "./text-values"
import { Uri } from "./uri"
import { Values } from "./values"

// Mirrors the content-plane ValueObjects of doc/arch/schemas/mcp/content.cue one-to-one
// (the URI/MIME allowlists live in ./uri-allowlist). Every tools/call and
// resources/read delivers a bounded preview plus an OutputRef only — never a filesystem
// path — and base64/data-URL content is decoded to a Feature 005 spool under the MIME
// allowlist and size caps (FR33, FR34, FR36, C16, C17). A resource_link stays lazy and
// is auto-fetched only under policy/Permission/budget (FR26, C11). Because the SDK
// parses the final result in RAM the spill is post-parse; zero-RAM is never promised
// (FR35, C16).

// BoundedPreview is the byte-capped redacted head slice delivered beside the OutputRef (FR34, C16).
export const BoundedPreview = Schema.Struct({
  content_kind: Enums.ContentKind,
  mime_type: Schema.NullOr(Uri.MimeType),
  byte_cap: Values.ByteLength,
  head: TextValues.RedactedText,
  secrets: Collections.SecretRefList,
}).annotate({ identifier: "McpContent.BoundedPreview" })
export type BoundedPreview = Schema.Schema.Type<typeof BoundedPreview>

// ContentItem is one spooled content item reached through its OutputRef; never a path (FR34, C16).
export const ContentItem = Schema.Struct({
  kind: Enums.ContentKind,
  mime_type: Schema.NullOr(Uri.MimeType),
  output_ref: Refs.OutputRef,
  byte_length: Values.ByteLength,
}).annotate({ identifier: "McpContent.ContentItem" })
export type ContentItem = Schema.Schema.Type<typeof ContentItem>

// ResourceLink is a lazy resource reference auto-fetched only under policy/Permission/budget (FR26, C11).
export const ResourceLink = Schema.Struct({
  resource_uri: Uri.ResourceUri,
  mime_type: Schema.NullOr(Uri.MimeType),
  title: TextValues.Title,
}).annotate({ identifier: "McpContent.ResourceLink" })
export type ResourceLink = Schema.Schema.Type<typeof ResourceLink>

// ContentItemList is the first-class collection of spooled content items (FR34, C16).
export const ContentItemList = Schema.Array(ContentItem).annotate({ identifier: "McpContent.ContentItemList" })
export type ContentItemList = typeof ContentItemList.Type

// ContentEnvelope is the bounded delivered envelope: items, preview, OutputRef, provenance (FR34, C16, C24).
export const ContentEnvelope = Schema.Struct({
  items: ContentItemList,
  preview: BoundedPreview,
  output_ref: Refs.OutputRef,
  provenance: Enums.ProvenanceClass,
}).annotate({ identifier: "McpContent.ContentEnvelope" })
export type ContentEnvelope = Schema.Schema.Type<typeof ContentEnvelope>

// McpCallOutput is the OutputGroup descriptor of one tools/call; preview plus OutputRef only (FR33, C16).
export const McpCallOutput = Schema.Struct({
  group_id: Refs.GroupId,
  request_id: Ids.RequestId,
  outcome: EnumsState.CallOutcome,
  preview: BoundedPreview,
  output_ref: Refs.OutputRef,
  byte_length: Values.ByteLength,
}).annotate({ identifier: "McpContent.McpCallOutput" })
export type McpCallOutput = Schema.Schema.Type<typeof McpCallOutput>

// McpReadOutput is the OutputGroup descriptor of one resources/read; preview plus OutputRef only (FR33, C16).
export const McpReadOutput = Schema.Struct({
  group_id: Refs.GroupId,
  resource_uri: Uri.ResourceUri,
  mime_type: Schema.NullOr(Uri.MimeType),
  preview: BoundedPreview,
  output_ref: Refs.OutputRef,
  byte_length: Values.ByteLength,
}).annotate({ identifier: "McpContent.McpReadOutput" })
export type McpReadOutput = Schema.Schema.Type<typeof McpReadOutput>
