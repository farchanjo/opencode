// DDD role: ValueObject
// Package: executor_composition.shared
// Bounded id, key, and version ValueObjects for the Feature 018 executor
// composition. Every operator-surface value is a named type so no primitive is
// carried inline (wrap-primitives). No field here holds a prompt, a session
// transcript, a spool page body, a definition secret, or a free-form command id;
// a scheduled session's content leaves the content plane only as an authorized
// paged output.read (Feature 005 C22). CUE packages are not cross-resolved by the
// structural reader; import paths mirror the operator-capability-gaps corpus style.

package executor_composition.shared

// CommandId is the canonical dotted domain.operation catalog id, unchanged by this feature (FR12).
#CommandId: string & =~"^[a-z][a-z0-9]*(\\.[a-z0-9-]+)+$"

// AuthorityKey is the Config.Service or store-scoped authority a mutation targets under mutateAuthority (FR7, FR13).
#AuthorityKey: string & =~"^[a-z][a-z0-9:_-]*$"

// Version is the opaque settled token on a mutation envelope; never parsed by the TUI (FR7, FR13).
#Version: string & !~"^$"

// CronExpression is the schedule expression the Bun cron adapter parses in UTC; carried for identity, never business logic (FR1).
#CronExpression: string & !~"^$"

// Timezone is the IANA timezone the schedule declares; a non-UTC zone is gated at registration (FR1, Feature 003 AC22).
#Timezone: string & !~"^$"

// ReasonText is a bounded, secret-free explanation carried on a typed capability-gap, denial, or conflict envelope (FR13, Security).
#ReasonText: string & !~"^$"

// DisplayLabel is the human label shown for a domain or verb; never the raw dotted id or a raw payload (FR11).
#DisplayLabel: string & !~"^$"
