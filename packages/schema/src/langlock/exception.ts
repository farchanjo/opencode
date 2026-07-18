export * as Exception from "./exception"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/langlock/exception.cue one-to-one. Operator-owned,
// schema-validated, allowlisted exemption records (FR14, C16, Security 2,
// Security 6). Untrusted LLM/plugin/prompt requests cannot create exemptions
// (Security 6, AC10). Exception use records bounded type, authority, scope and
// result without content (Security 6).

// ExceptionAuthority carries the owning principal, scope and CAS version of an entry (FR14, C16).
export const ExceptionAuthority = Schema.Struct({
  principal: Correlation.Principal,
  scope: Enums.Scope,
  version: Values.PolicyVersion,
}).annotate({ identifier: "LangLockException.ExceptionAuthority" })
export type ExceptionAuthority = Schema.Schema.Type<typeof ExceptionAuthority>

// ExceptionEntry is one operator-owned exemption of a bounded category (FR14, C16, Security 6).
export const ExceptionEntry = Schema.Struct({
  id: Ids.ExceptionId,
  category: Enums.ExceptionCategory, // bounded exemption kind (FR14, C16)
  authority: ExceptionAuthority,
  reason: TextValues.Reason, // bounded; no content (Security 6)
  created_at: DateTimeUtcFromMillis,
}).annotate({ identifier: "LangLockException.ExceptionEntry" })
export type ExceptionEntry = Schema.Schema.Type<typeof ExceptionEntry>

// ExceptionEntryList is the first-class collection of manifest entries (FR14, C16).
export const ExceptionEntryList = Schema.Array(ExceptionEntry)
export type ExceptionEntryList = Schema.Schema.Type<typeof ExceptionEntryList>

// ExceptionManifest is the operator-owned manifest bound to a policy (FR14, C16).
export const ExceptionManifest = Schema.Struct({
  manifest_ref: Correlation.ManifestRef,
  authority: ExceptionAuthority,
  entries: ExceptionEntryList,
  updated_at: DateTimeUtcFromMillis,
}).annotate({ identifier: "LangLockException.ExceptionManifest" })
export type ExceptionManifest = Schema.Schema.Type<typeof ExceptionManifest>
