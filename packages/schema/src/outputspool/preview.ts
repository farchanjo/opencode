export * as Preview from "./preview"

import { Schema } from "effect"
import { Correlation } from "./correlation"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/outputspool/preview.cue one-to-one. BoundedPreview is
// the byte-and-line-capped, redacted head slice attached to EventV2 payloads, UI
// cards and NotificationEnvelope summaries alongside the opaque OutputRef only
// (FR4, FR33, C8). It is never a path and never a full channel; secret material
// is represented as a Feature 007 SecretRef, never inline plaintext (FR5, C22).

// PreviewText is the bounded redacted head slice text; empty is valid, never full content (FR4, C8).
export const PreviewText = Schema.String.annotate({ identifier: "OutputSpoolValues.PreviewText" })
export type PreviewText = typeof PreviewText.Type

// SecretRefList is the first-class collection of SecretRefs redacted out of a preview (FR5, C22).
export const SecretRefList = Schema.Array(Correlation.SecretRef)
export type SecretRefList = Schema.Schema.Type<typeof SecretRefList>

// BoundedPreview is the redacted head slice plus its caps and redacted secret refs (FR4, C8, C22).
export const BoundedPreview = Schema.Struct({
  content_type: TextValues.ContentType,
  byte_cap: Values.ByteLength,
  line_cap: Values.ByteLength,
  head: PreviewText,
  secrets: SecretRefList,
}).annotate({ identifier: "OutputSpoolPreview.BoundedPreview" })
export type BoundedPreview = Schema.Schema.Type<typeof BoundedPreview>
