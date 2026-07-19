// DDD role: ValueObject
// Package: operator_crud_screens.shared
// Bounded text ValueObjects shared across the Feature 015 operator CRUD screens.
// Copy is centralised where it is produced (palette.ts) with no i18n layer; these
// types bound the human labels, the unique row titles that replace the duplicated
// "View: Status" wall, and the canonical command id kept discoverable as a
// secondary line (FR1, FR3). No field carries secrets or raw payload content.

package operator_crud_screens.shared

// CommandId is the canonical dotted domain.operation catalog id, kept discoverable but never the primary label (FR3, FR17).
#CommandId: string & =~"^[a-z][a-z0-9]*(\\.[a-z0-9-]+)+$"

// DomainLabel is the human label shown for a domain screen; never the raw domain token (FR3).
#DomainLabel: string & !~"^$"

// RowTitle is the unique human title of a screen row; no two rows on a surface share it, and it is never the dotted id (FR3).
#RowTitle: string & !~"^$"

// FieldLabel is the human label shown beside an editable field in an edit modal (FR9).
#FieldLabel: string & !~"^$"

// BadgeText is the short state/availability marker rendered on a toggle, tri-state, or entity row (FR7, FR8, FR15).
#BadgeText: string & !~"^$"

// EntityId is the bounded identifier of a managed entity row (job, provider, model, mcp server) (FR12, FR13, FR14).
#EntityId: string & !~"^$"
