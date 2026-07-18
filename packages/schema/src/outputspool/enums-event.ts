export * as EnumsEvent from "./enums-event"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/outputspool/enums-event.cue (package
// outputspool.enums) one-to-one for the event class/source/actor/visibility,
// settlement-outcome, language-provenance and export-encoding enums carried on
// the output.* event envelope and admin surface (C17, C20, C22). Durable
// settlement events replay through the single EventV2 authority; live signals may
// be dropped under load (C20). Administration is native operator-only; no LLM
// ever administers (FR41, C22).

// EventClass separates durable (replayable settlement) from live (droppable) output.* events (C20).
export const EventClass = Schema.Literals(["durable", "live"]).annotate({
  identifier: "OutputSpoolEnums.EventClass",
})
export type EventClass = typeof EventClass.Type

// EventSource names the origin subsystem of an output.* event (C20).
export const EventSource = Schema.Literals([
  "producer",
  "writer",
  "reader",
  "reconciler",
  "retention",
  "operator",
]).annotate({ identifier: "OutputSpoolEnums.EventSource" })
export type EventSource = typeof EventSource.Type

// ActorKind names who acted to produce the event; no LLM ever administers (FR41, C22).
export const ActorKind = Schema.Literals(["runtime", "operator"]).annotate({
  identifier: "OutputSpoolEnums.ActorKind",
})
export type ActorKind = typeof ActorKind.Type

// Visibility is the authorization scope enforced before delivery/projection (FR47, C7).
export const Visibility = Schema.Literals(["session", "tree", "project", "operator-global"]).annotate({
  identifier: "OutputSpoolEnums.Visibility",
})
export type Visibility = typeof Visibility.Type

// SettlementOutcome is the content-plane settlement result observed by the parent (FR23, C13).
export const SettlementOutcome = Schema.Literals(["sealed", "aborted", "unknown", "corrupt"]).annotate({
  identifier: "OutputSpoolEnums.SettlementOutcome",
})
export type SettlementOutcome = typeof SettlementOutcome.Type

// LanguageProvenance records how a channel language tag was obtained; content-free (FR40, C8).
export const LanguageProvenance = Schema.Literals(["declared", "inherited", "detected", "none"]).annotate({
  identifier: "OutputSpoolEnums.LanguageProvenance",
})
export type LanguageProvenance = typeof LanguageProvenance.Type

// ExportEncoding is the bounded allowed export encoding; never a raw path (FR44, C17).
export const ExportEncoding = Schema.Literals(["bounded_text", "redacted_bundle", "content_page"]).annotate({
  identifier: "OutputSpoolEnums.ExportEncoding",
})
export type ExportEncoding = typeof ExportEncoding.Type
