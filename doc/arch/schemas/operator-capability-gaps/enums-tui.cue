// DDD role: ValueObject
// Package: operator_capability_gaps.enums
// Bounded enums for the Feature 017 operator-TUI editing surface (Group 7): the
// per-property input kinds the multi-field edit modal renders, the per-verb
// availability class the grouped menu derives, and the two distinct
// effective-payload renderers (the compact bounded-height status strip vs the
// detail expand tree). Shares the enums package with enums.cue (multiple files,
// one package — the operator-persistence corpus precedent).

package operator_capability_gaps.enums

// FieldInputKind is the closed set of input kinds the multi-field edit modal renders per payload property (FR19, FR21).
#FieldInputKind: "text" | "numeric" | "toggle" | "picker" | "bindings_list" | "advanced_json"

// PersistenceClass is the per-verb availability class the grouped TUI derives; partial marks a mixed domain honestly (FR15).
#PersistenceClass: "persists_today" | "partial" | "honest_unavailable"

// ViewRenderer names the two distinct effective-payload renderers: the compact bounded-height strip and the detail expand tree (FR23).
#ViewRenderer: "compact_strip" | "detail_tree"
