// DDD role: ValueObject
// Package: operator_screen_layout.shared
// Bounded text ValueObjects shared across the Feature 016 screen-layout polish.
// Copy stays centralised where it is produced (palette.ts) with no i18n layer;
// these wrapped primitives bound the human row titles that carry the action, the
// section labels that alone carry the kind, the status-group names summarised when
// empty, and the canonical command id kept as a secondary line only when it fits
// without truncation (FR2, FR3, FR5). No field carries secrets or raw payload
// content; the empty-group summary names only group labels.

package operator_screen_layout.shared

// CommandId is the canonical dotted domain.operation catalog id, kept as a secondary line only when it fits without truncation, never the primary label (FR3, FR6).
#CommandId: string & =~"^[a-z][a-z0-9]*(\\.[a-z0-9-]+)+$"

// DomainLabel is the human label shown in the screen header; never the raw domain token (FR1).
#DomainLabel: string & !~"^$"

// RowTitle is the action carried by an action row; the section header carries the kind, so the title is never a kind badge or a dotted id (FR3).
#RowTitle: string & !~"^$"

// SectionLabel is the header of a section (View / Configure); it alone carries the row kind (FR3).
#SectionLabel: string & !~"^$"

// GroupName is the label of a status group named in the compact empty-group summary line (FR2).
#GroupName: string & !~"^$"

// SummaryText is the single collapsed line summarising the empty status groups (e.g. "servers · resources · calls: empty") (FR2).
#SummaryText: string & !~"^$"
