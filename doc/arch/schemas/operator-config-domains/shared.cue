// DDD role: ValueObject
// Package: operator_config_domains.shared
// Bounded text, id, and version ValueObjects for the Feature 013 config-backed
// domain ports. Every operator-surface value is a named type so no primitive is
// carried inline (wrap-primitives). The SecretRef is an opaque Feature 007
// SecretPort reference — never a plaintext header value; telemetry.configure
// carries only this reference (Security, FR6). No field here holds a secret,
// a raw header value, or a free-form command id.

package operator_config_domains.shared

// Version is the opaque Config.Service CAS version token carried on the handled result; never parsed by the TUI (FR7, FR12).
#Version: string & !~"^$"

// CommandId is the canonical dotted domain.operation catalog id, unchanged by this feature (FR11).
#CommandId: string & =~"^[a-z][a-z0-9]*(\\.[a-z0-9-]+)+$"

// AuthorityKey is the Config.Service authority key a domain mutation targets (for example routing or global:routing) (FR9, FR12).
#AuthorityKey: string & =~"^[a-z][a-z0-9:_-]*$"

// SecretRef is the opaque Feature 007 SecretPort reference for a telemetry export header; never a plaintext value (Security, FR6).
#SecretRef: string & =~"^(?:[A-Za-z0-9._-]+:[^@]+(?:@v[1-9][0-9]*)?)?$"

// EndpointUrl is the configured OTLP export endpoint the probe targets; http/https only (FR6).
#EndpointUrl: string & =~"^https?://"

// ReasonText is a bounded, secret-free explanation carried on a typed unavailable/invalid envelope (FR8, Security).
#ReasonText: string & !~"^$"

// Iso8601 is the ISO-8601 timestamp of the last effective config mutation (FR1).
#Iso8601: string & =~"^[0-9]{4}-[0-9]{2}-[0-9]{2}T"

// DisplayLabel is the human label shown for a domain or verb row; never the raw dotted id (FR9).
#DisplayLabel: string & !~"^$"

// RolePoolName is a role-pool key from the RoutingConfig Models role_pools map (FR5).
#RolePoolName: string & !~"^$"

// ModelId is one candidate model id bound to a role pool; content-free (FR5).
#ModelId: string & !~"^$"
