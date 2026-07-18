/**
 * Feature 007 — operator control-plane durable audit event (T022/T024).
 * Content-free fields only; aggregateID isolates operator audit stream.
 */
export * as OperatorEvent from "./operator-event"

import { Schema } from "effect"
import { Event } from "./event"

/** Stable durable version for operator.audit. */
export const AUDIT_DURABLE_VERSION = 1 as const

/**
 * Canonical durable operator audit event.
 * Aggregate field `aggregateID` (e.g. "operator" or "operator:{projectKey}").
 */
export const Audit = Event.define({
  type: "operator.audit",
  durable: {
    version: AUDIT_DURABLE_VERSION,
    aggregate: "aggregateID",
  },
  schema: {
    aggregateID: Schema.String,
    source: Schema.String,
    actorRef: Schema.String,
    scopeKind: Schema.String,
    scopeRef: Schema.NullOr(Schema.String),
    commandId: Schema.String,
    beforeVersion: Schema.NullOr(Schema.String),
    afterVersion: Schema.NullOr(Schema.String),
    outcome: Schema.String,
    createdAtMs: Schema.Number,
  },
})

export type Audit = typeof Audit.Type

export const Definitions = Event.inventory(Audit)
export const DurableDefinitions = Event.inventory(Audit)
