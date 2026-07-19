// DDD role: ValueObject
// Package: operator_crud_screens.enums
// Bounded enums for the Feature 015 operator CRUD screen model. They describe the
// TUI presentation projection over the Feature 007 reserved catalog and the
// Feature 014 per-verb availability only: the screen navigation node, the section
// a control lands in, how a status renders, the control kind, the toggle state,
// and the tri-state routing mode (FR1-FR18). No new dispatch path is introduced;
// command IDs stay canonical and every control rides the same OperatorClient
// loopback as slash/CLI (FR17).

package operator_crud_screens.enums

// OperatorDomain is the closed set of 12 reserved catalog domains surfaced as CRUD screens (FR3, FR4).
#OperatorDomain: "telemetry" | "smart" | "routing" | "budget" | "pools" | "process" | "task" | "jobs" | "langlock" | "output" | "semantic" | "mcp"

// ScreenNode names the navigation states of the CRUD screen over the Dialog push/back-stack (FR4, FR9, FR11, FR12).
#ScreenNode: "screen" | "edit_modal" | "view_modal" | "entity_list" | "entity_item" | "create_modal"

// SectionKind splits a domain screen into its composed sections: an inline status, toggle rows, editable settings, entity lists, and detail views (FR4, FR7, FR9, FR11, FR12).
#SectionKind: "status" | "toggles" | "settings" | "entities" | "detail"

// StatusRenderer selects the inline status projection: a generic key/value renderer for plain domains or the reused rich panel for jobs/output/langlock/semantic/mcp (FR4).
#StatusRenderer: "key_value" | "rich_panel"

// ControlKind is the interaction a settings/entity row exposes: a toggle, a tri-state picker, an edit modal, a view modal, or an entity action (FR7, FR8, FR9, FR11, FR12).
#ControlKind: "toggle" | "tristate_picker" | "edit_modal" | "view_modal" | "entity_action"

// ToggleState is the current on/off affordance of a toggle row; unavailable marks a typed capability gap that is inert (FR7, FR15).
#ToggleState: "enabled" | "disabled" | "unavailable"

// TriState is the smart-routing mode a tri-state picker selects; a binary toggle cannot honestly represent it (FR8).
#TriState: "on" | "off" | "auto"
