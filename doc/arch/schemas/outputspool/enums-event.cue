// DDD role: ValueObject
// Package: outputspool.enums
// Event class, source, actor, visibility, settlement outcome, language provenance
// and export encoding enums carried on the output.* event envelope and admin
// surface (C17, C20, C22). Durable settlement events replay through the single
// EventV2 authority; live signals may be dropped under load (C20). Visibility is
// enforced before delivery or projection (FR47, Security 1).

package outputspool.enums

// EventClass separates durable (replayable settlement) from live (droppable) output.* events (C20).
#EventClass: "durable" | "live"

// EventSource names the origin subsystem of an output.* event (C20).
#EventSource: "producer" | "writer" | "reader" | "reconciler" | "retention" | "operator"

// ActorKind names who acted to produce the event; no LLM ever administers (FR41, C22).
#ActorKind: "runtime" | "operator"

// Visibility is the authorization scope enforced before delivery/projection (FR47, C7).
#Visibility: "session" | "tree" | "project" | "operator-global"

// SettlementOutcome is the content-plane settlement result observed by the parent (FR23, C13).
#SettlementOutcome: "sealed" | "aborted" | "unknown" | "corrupt"

// LanguageProvenance records how a channel language tag was obtained; content-free (FR40, C8).
#LanguageProvenance: "declared" | "inherited" | "detected" | "none"

// ExportEncoding is the bounded allowed export encoding; never a raw path (FR44, C17).
#ExportEncoding: "bounded_text" | "redacted_bundle" | "content_page"
