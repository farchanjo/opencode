export * as Ids from "./ids"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/langlock/ids.cue (package langlock.shared) one-to-one
// for the Feature 004 Lang Lock engine (FR1, FR4, FR5, FR14, C2, C8, C16).
//
// Name parity with lifecycle.shared / routing.shared / jobs.shared is
// intentional — this feature does not cross-import those modules, so the
// identifier concepts are re-declared locally (C2, C8).
//
// ANNOTATION ORDER: every exported schema is annotated with its root
// identifier BEFORE any `.check(...)` is applied, and branded only after the
// check. Annotating an already-checked schema drops the root identifier from
// `.ast.annotations` in favor of annotating the last check instead, so
// base-then-check-then-brand is load-bearing for contract hygiene (see
// test/contract-hygiene.test.ts).

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const eventIdPattern = /^evt_[A-Za-z0-9_-]{1,120}$/
// Canonical BCP 47: language, optional script, optional region — the value is
// also validated at runtime by Intl.getCanonicalLocales plus the allowlist
// (FR4, C13).
const languageTagPattern = /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$/

// LanguageTag is a canonical BCP 47 artifact-language tag (FR1, FR4).
export const LanguageTag = Schema.String.annotate({ identifier: "LangLockIds.LanguageTag" })
  .check(Schema.isPattern(languageTagPattern))
  .pipe(Schema.brand("LangLock.LanguageTag"))
export type LanguageTag = typeof LanguageTag.Type

// PolicyId identifies one durable Lang Lock policy record in Config.Service (FR5, C2).
export const PolicyId = Schema.String.annotate({ identifier: "LangLockIds.PolicyId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("LangLock.PolicyId"))
export type PolicyId = typeof PolicyId.Type

// ExceptionId identifies one operator-owned exception-manifest entry (FR14, C16).
export const ExceptionId = Schema.String.annotate({ identifier: "LangLockIds.ExceptionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("LangLock.ExceptionId"))
export type ExceptionId = typeof ExceptionId.Type

// ExecutionId is the opaque execution correlation id — never a metric label (Observability, C8).
export const ExecutionId = Schema.String.annotate({ identifier: "LangLockIds.ExecutionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("LangLock.ExecutionId"))
export type ExecutionId = typeof ExecutionId.Type

// EventId is the EventV2 evt_ id assigned per published langlock.* event (C8).
export const EventId = Schema.String.annotate({ identifier: "LangLockIds.EventId" })
  .check(Schema.isPattern(eventIdPattern))
  .pipe(Schema.brand("LangLock.EventId"))
export type EventId = typeof EventId.Type
