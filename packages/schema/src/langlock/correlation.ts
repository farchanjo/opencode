export * as Correlation from "./correlation"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/langlock/correlation.cue (package langlock.shared)
// one-to-one. Correlation, principal and reference ValueObjects carry opaque
// handles only; Feature 005 owns output bytes and Feature 002 owns Todo content
// (FR28, FR30, Security 5, C9, C10). Same annotate-before-check-then-brand
// discipline as ./ids.

const idPattern = /^[A-Za-z0-9_-]{1,128}$/

// CorrelationId groups related langlock.* events across one logical execution (C8).
export const CorrelationId = Schema.String.annotate({ identifier: "LangLockIds.CorrelationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("LangLock.CorrelationId"))
export type CorrelationId = typeof CorrelationId.Type

// CausationId references the event that directly caused this one (C8).
export const CausationId = Schema.String.annotate({ identifier: "LangLockIds.CausationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("LangLock.CausationId"))
export type CausationId = typeof CausationId.Type

// RootSessionId references the authorized root-session tree carrying the lock (FR26, C11).
export const RootSessionId = Schema.String.annotate({ identifier: "LangLockIds.RootSessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("LangLock.RootSessionId"))
export type RootSessionId = typeof RootSessionId.Type

// SessionId references the session an execution envelope belongs to (FR26, C11).
export const SessionId = Schema.String.annotate({ identifier: "LangLockIds.SessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("LangLock.SessionId"))
export type SessionId = typeof SessionId.Type

// Principal is the operator/system principal that owns or acts on a policy (Security 1, Security 4).
export const Principal = Schema.String.annotate({ identifier: "LangLockIds.Principal" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("LangLock.Principal"))
export type Principal = typeof Principal.Type

// ProjectRef references the project scope a policy override is bound to (FR5, C2).
export const ProjectRef = Schema.String.annotate({ identifier: "LangLockIds.ProjectRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("LangLock.ProjectRef"))
export type ProjectRef = typeof ProjectRef.Type

// TodoRef references the Feature 002 session-owned Todo whose text follows the lock (FR28, C10).
export const TodoRef = Schema.String.annotate({ identifier: "LangLockIds.TodoRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("LangLock.TodoRef"))
export type TodoRef = typeof TodoRef.Type

// OutputRef is a bounded opaque Feature 005 reference; Feature 005 owns bytes/provenance (FR30, C9).
export const OutputRef = Schema.String.annotate({ identifier: "LangLockIds.OutputRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("LangLock.OutputRef"))
export type OutputRef = typeof OutputRef.Type

// ManifestRef references the operator-owned exception manifest a policy binds (FR14, C16).
export const ManifestRef = Schema.String.annotate({ identifier: "LangLockIds.ManifestRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("LangLock.ManifestRef"))
export type ManifestRef = typeof ManifestRef.Type
