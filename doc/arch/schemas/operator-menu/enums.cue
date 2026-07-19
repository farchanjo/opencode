// DDD role: ValueObject
// Package: operator_menu.enums
// Bounded enums for the Feature 011 grouped operator menu navigation model. They
// describe the TUI projection over the Feature 007 reserved catalog only: the
// navigation node, the section a verb lands in, its availability affordance, the
// input it collects, and whether its backend persists today (FR1-FR7). No new
// dispatch path is introduced; command IDs stay canonical (FR8).

package operator_menu.enums

// OperatorDomain is the closed set of 12 reserved catalog domains surfaced in the group menu (FR2).
#OperatorDomain: "telemetry" | "smart" | "routing" | "budget" | "pools" | "process" | "task" | "jobs" | "langlock" | "output" | "semantic" | "mcp"

// NavNode names the navigation states of the Dialog push/replace stack: group list, domain panel, and the three leaf surfaces (FR1, FR3, FR5, FR6).
#NavNode: "home" | "domain_panel" | "result_toast" | "confirm_dialog" | "input_form"

// VerbSection splits a domain panel into a read-only View section and a mutating Configure section (FR3).
#VerbSection: "view" | "configure"

// VerbAvailability is the per-verb affordance badge: ready, gated on confirmation, or honest-unavailable (FR3, FR4, FR7).
#VerbAvailability: "available" | "confirm_required" | "unavailable"

// InputMode names the typed form a Configure verb opens to collect its payload before dispatch (FR5).
#InputMode: "none" | "value_picker" | "text_input"

// PersistenceClass records whether a verb's backend persists today or remains honest-unavailable until it lands (FR7).
#PersistenceClass: "persists_today" | "honest_unavailable"
