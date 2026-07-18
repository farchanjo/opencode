export * as EnumsEvent from "./enums-event"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/semantic/enums-event.cue (package semantic.enums)
// one-to-one for the event-envelope enums carried on the semantic.* event surface
// (C22). Durable index/binding/cutover events replay through the single EventV2
// authority; live degradation/probe signals may be dropped under load (C22). An
// actor is runtime or operator; an LLM never administers (FR31, FR35, C15). A
// cutover outcome records the CAS result of an atomic all-collections alias swap
// (FR12, C12). The closed semantic.* vocabulary lives in ./event-types.

// EventClass separates durable (replayable) from live (droppable) semantic.* events (C22).
export const EventClass = Schema.Literals(["durable", "live"]).annotate({ identifier: "SemanticEnumsEvent.EventClass" })
export type EventClass = typeof EventClass.Type

// EventSource names the origin subsystem of a semantic.* event (C22).
export const EventSource = Schema.Literals([
  "operator",
  "indexer",
  "reconciler",
  "retriever",
  "cutover",
]).annotate({ identifier: "SemanticEnumsEvent.EventSource" })
export type EventSource = typeof EventSource.Type

// ActorKind names who acted; an LLM/router/agent/plugin/MCP never administers (FR31, C15).
export const ActorKind = Schema.Literals(["runtime", "operator"]).annotate({
  identifier: "SemanticEnumsEvent.ActorKind",
})
export type ActorKind = typeof ActorKind.Type

// CutoverOutcome is the CAS result of an atomic all-collections alias swap (FR12, C12, AC31).
export const CutoverOutcome = Schema.Literals(["committed", "contended", "rolled-back"]).annotate({
  identifier: "SemanticEnumsEvent.CutoverOutcome",
})
export type CutoverOutcome = typeof CutoverOutcome.Type

// FreshnessBucket is the bounded staleness bucket gating semantic-score contribution (FR27, C11, AC5).
export const FreshnessBucket = Schema.Literals(["fresh", "bounded", "stale"]).annotate({
  identifier: "SemanticEnumsEvent.FreshnessBucket",
})
export type FreshnessBucket = typeof FreshnessBucket.Type
