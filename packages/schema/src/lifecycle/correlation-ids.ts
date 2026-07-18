export * as CorrelationIds from "./correlation-ids"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/lifecycle/correlation.cue (package lifecycle.shared)
// one-to-one. The routing-parity ids (DecisionId, TurnId, ModelId,
// ProviderName, VariantName) mirror routing.shared by name; they are
// re-declared here, not cross-imported (C15).
//
// ANNOTATION ORDER: see ids.ts — annotate before check, brand after check.

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/

// CorrelationId groups related events across a logical operation.
export const CorrelationId = Schema.String.annotate({ identifier: "LifecycleCorrelationIds.CorrelationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Lifecycle.CorrelationId"))
export type CorrelationId = typeof CorrelationId.Type

// CausationId references the event that directly caused this one.
export const CausationId = Schema.String.annotate({ identifier: "LifecycleCorrelationIds.CausationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Lifecycle.CausationId"))
export type CausationId = typeof CausationId.Type

// DecisionId references a Feature 001 routing.decision — parity id (ULID).
export const DecisionId = Schema.String.annotate({ identifier: "LifecycleCorrelationIds.DecisionId" })
  .check(Schema.isPattern(ulidPattern))
  .pipe(Schema.brand("Lifecycle.DecisionId"))
export type DecisionId = typeof DecisionId.Type

// TurnId references a single turn within a Session — parity id.
export const TurnId = Schema.String.annotate({ identifier: "LifecycleCorrelationIds.TurnId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Lifecycle.TurnId"))
export type TurnId = typeof TurnId.Type

// AgentName is the canonical specialist-agent name for a process.
export const AgentName = Schema.String.annotate({ identifier: "LifecycleCorrelationIds.AgentName" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Lifecycle.AgentName"))
export type AgentName = typeof AgentName.Type

// ModelId is a canonical model identifier — parity id.
export const ModelId = Schema.String.annotate({ identifier: "LifecycleCorrelationIds.ModelId" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Lifecycle.ModelId"))
export type ModelId = typeof ModelId.Type

// ProviderName names a model provider — parity id.
export const ProviderName = Schema.String.annotate({ identifier: "LifecycleCorrelationIds.ProviderName" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Lifecycle.ProviderName"))
export type ProviderName = typeof ProviderName.Type

// VariantName names a provider/model variant — parity id.
export const VariantName = Schema.String.annotate({ identifier: "LifecycleCorrelationIds.VariantName" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Lifecycle.VariantName"))
export type VariantName = typeof VariantName.Type

// TodoRef references a Session-owned Todo aggregate observed by the row.
export const TodoRef = Schema.String.annotate({ identifier: "LifecycleCorrelationIds.TodoRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Lifecycle.TodoRef"))
export type TodoRef = typeof TodoRef.Type

// TodoVersion pins an opaque monotonic Todo revision token.
export const TodoVersion = Schema.String.annotate({ identifier: "LifecycleCorrelationIds.TodoVersion" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Lifecycle.TodoVersion"))
export type TodoVersion = typeof TodoVersion.Type
