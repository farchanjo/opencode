// DDD role: ValueObject
// Package: operator_menu.shared
// Bounded text and count ValueObjects for the Feature 011 grouped operator menu.
// Copy is centralised where it is produced (palette.ts) with no i18n layer; these
// types bound the human labels and the relabelled subtitle that replaces the poor
// "Operator query: <id>" line (FR2, FR4). No field carries secrets or content.

package operator_menu.shared

// DomainLabel is the human label shown for a domain group row; never the raw domain token (FR2).
#DomainLabel: string & !~"^$"

// VerbLabel is the human label shown for a verb row; a view or configure action, not the dotted id (FR3, FR4).
#VerbLabel: string & !~"^$"

// Subtitle is the relabelled secondary line replacing "Operator query: <id>"; view/configure/unavailable copy (FR4).
#Subtitle: string & !~"^$"

// CommandId is the canonical dotted domain.operation catalog id, kept discoverable but not the primary label (FR4, FR8).
#CommandId: string & =~"^[a-z][a-z0-9]*(\\.[a-z0-9-]+)+$"

// Badge is the short availability marker text rendered next to a domain or verb row (FR2, FR3, FR7).
#Badge: string & !~"^$"

// VerbCount is a bounded count of verbs in a domain section, shown in the domain-row subtitle (FR2, FR4).
#VerbCount: uint & >=0
