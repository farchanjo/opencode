// DDD role: ValueObject
// Package: operator_screen_layout.enums
// Bounded enums for the Feature 016 operator screen-layout polish. They type the
// presentation-only re-layout over the Feature 015 CRUD screens: the ordered
// screen regions the panel reads through, the state of a status group (so empty
// groups collapse), the section a row lands in (so Configure leads View), the
// availability marker a row carries only when the verb is not fully available, and
// the entity-first affordance kind (FR1-FR6). No new dispatch path is introduced;
// command IDs stay canonical and every row rides the same OperatorClient loopback
// as slash/CLI (FR6).

package operator_screen_layout.enums

// ScreenRegion is the ordered set of regions a domain screen reads through, top to bottom, as one coherent panel (FR1).
#ScreenRegion: "header" | "status" | "search" | "actions"

// StatusGroupState decides how a status group renders: populated groups render in full, empty groups collapse to a summary line, and Loading/unavailable stay explicit (FR2).
#StatusGroupState: "populated" | "empty" | "loading" | "unavailable"

// SectionKind names the section a row belongs to; its header alone carries the kind, and Configure orders before View for editable domains (FR3, FR4).
#SectionKind: "configure" | "view"

// AvailabilityMarker is the per-row marker rendered only when the verb is not fully available; a fully-available verb carries none (FR3, FR6).
#AvailabilityMarker: "unavailable" | "confirm" | "secret"

// AffordanceKind is the entity-first Configure affordance an entity domain leads with: a create action or its collection list (FR5).
#AffordanceKind: "create" | "list"
