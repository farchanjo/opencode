export * as Quota from "./quota"

import { Schema } from "effect"
import { Enums } from "./enums"
import { Values } from "./values"

// Mirrors doc/arch/schemas/outputspool/quota.cue one-to-one. QuotaDescriptor is
// the per-scope backpressure and admission caps applied at global, root, session,
// process and channel scopes (FR10, C3). Numeric caps are provisional plan
// constants owned by Feature 007 Config.Service; unbounded page size, queue depth
// or retention is prohibited (Out of Scope). Quota exceed is a first-class
// observable admission fault, never swallowed (FR10, C4, AC7).

// QuotaDescriptor is one scope's byte, queue-depth and page caps (FR10, C3, AC7).
export const QuotaDescriptor = Schema.Struct({
  scope: Enums.QuotaScope,
  byte_cap: Values.ByteLength,
  queue_depth_cap: Values.QueueDepthBytes,
  page_cap: Values.PageLimit,
}).annotate({ identifier: "OutputSpoolQuota.QuotaDescriptor" })
export type QuotaDescriptor = Schema.Schema.Type<typeof QuotaDescriptor>

// QuotaSet is the first-class collection of per-scope quota descriptors (FR10, C3).
export const QuotaSet = Schema.Array(QuotaDescriptor)
export type QuotaSet = Schema.Schema.Type<typeof QuotaSet>
