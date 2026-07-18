// DDD role: ValueObject
// Package: semantic.enums
// Event-envelope enums carried on the semantic.* event surface (C22). Durable index,
// binding and cutover events replay through the single EventV2 authority; live
// degradation and probe signals may be dropped under load (C22). An actor is runtime
// or operator; an LLM never administers (FR31, FR35, C15). A cutover outcome records
// the CAS result of an atomic blue/green alias swap of all collections (FR12, C12).

package semantic.enums

// EventClass separates durable (replayable) from live (droppable) semantic.* events (C22).
#EventClass: "durable" | "live"

// EventSource names the origin subsystem of a semantic.* event (C22).
#EventSource: "operator" | "indexer" | "reconciler" | "retriever" | "cutover"

// ActorKind names who acted; an LLM/router/agent/plugin/MCP never administers (FR31, C15).
#ActorKind: "runtime" | "operator"

// CutoverOutcome is the CAS result of an atomic all-collections alias swap (FR12, C12, AC31).
#CutoverOutcome: "committed" | "contended" | "rolled-back"

// FreshnessBucket is the bounded staleness bucket gating semantic-score contribution (FR27, C11, AC5).
#FreshnessBucket: "fresh" | "bounded" | "stale"
