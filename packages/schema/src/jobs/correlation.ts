export * as Correlation from "./correlation"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/jobs/correlation.cue (package jobs.shared) one-to-one.
// Correlation, principal and secure-reference ValueObjects carry opaque handles
// only; secrets are OS-keychain-backed references, never raw values (Security 3,
// C10). DecisionId / TurnId keep Feature 001 routing parity (C11).
//
// ANNOTATION ORDER: see ids.ts — annotate before check, brand after check.

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const decisionIdPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/

// CorrelationId groups related job.* events across a logical occurrence (FR12).
export const CorrelationId = Schema.String.annotate({ identifier: "JobsIds.CorrelationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.CorrelationId"))
export type CorrelationId = typeof CorrelationId.Type

// CausationId references the event that directly caused this one (FR12).
export const CausationId = Schema.String.annotate({ identifier: "JobsIds.CausationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.CausationId"))
export type CausationId = typeof CausationId.Type

// DecisionId references a Feature 001 routing.decision — parity id (ULID, C11).
export const DecisionId = Schema.String.annotate({ identifier: "JobsIds.DecisionId" })
  .check(Schema.isPattern(decisionIdPattern))
  .pipe(Schema.brand("Jobs.DecisionId"))
export type DecisionId = typeof DecisionId.Type

// TurnId references a single turn within a Session — parity id.
export const TurnId = Schema.String.annotate({ identifier: "JobsIds.TurnId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.TurnId"))
export type TurnId = typeof TurnId.Type

// Principal is the operator/system principal that owns or acts on a definition (C10, C12).
export const Principal = Schema.String.annotate({ identifier: "JobsIds.Principal" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Jobs.Principal"))
export type Principal = typeof Principal.Type

// SecretRef is an OS-keychain-backed secure reference — never a raw secret (Security 3, C10).
export const SecretRef = Schema.String.annotate({ identifier: "JobsIds.SecretRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Jobs.SecretRef"))
export type SecretRef = typeof SecretRef.Type

// PayloadRef is a redacted payload reference; large content stays out of band (FR22, Privacy).
export const PayloadRef = Schema.String.annotate({ identifier: "JobsIds.PayloadRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Jobs.PayloadRef"))
export type PayloadRef = typeof PayloadRef.Type

// OutputRef is a bounded opaque Feature 005 reference; Feature 005 owns bytes (FR8a, FR22, C15).
export const OutputRef = Schema.String.annotate({ identifier: "JobsIds.OutputRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Jobs.OutputRef"))
export type OutputRef = typeof OutputRef.Type

// ProjectRef references the project scope a definition is bound to (C12).
export const ProjectRef = Schema.String.annotate({ identifier: "JobsIds.ProjectRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Jobs.ProjectRef"))
export type ProjectRef = typeof ProjectRef.Type

// TodoRef references the occurrence-owned Feature 002 Todo aggregate (FR8, C14).
export const TodoRef = Schema.String.annotate({ identifier: "JobsIds.TodoRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Jobs.TodoRef"))
export type TodoRef = typeof TodoRef.Type
