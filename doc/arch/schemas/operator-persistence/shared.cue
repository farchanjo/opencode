// DDD role: ValueObject
// Package: operator_persistence.shared
// Bounded text, id, path, and version ValueObjects for the Feature 014 operator
// persistence completion. Every operator-surface value is a named type so no
// primitive is carried inline (wrap-primitives). The SecretRef is an opaque
// Feature 007 SecretPort reference — never a plaintext value; the persisted
// operator config namespace carries only this reference for secret values
// (Security, FR11). No field here holds a secret, a raw payload, or a free-form
// command id.

package operator_persistence.shared

// Version is the opaque Config.Service CAS version token carried on a mutation envelope; never parsed by the TUI (FR4, FR5).
#Version: string & !~"^$"

// CommandId is the canonical dotted domain.operation catalog id, unchanged by this feature (FR13).
#CommandId: string & =~"^[a-z][a-z0-9]*(\\.[a-z0-9-]+)+$"

// AuthorityKey is the Config.Service authority key a mutation targets (for example routing, global:telemetry) (FR2, FR3).
#AuthorityKey: string & =~"^[a-z][a-z0-9:_-]*$"

// ConfigFilePath is a config file basename the write path lands on and the loader reads; the round-trip aligns the two (FR2).
#ConfigFilePath: string & =~"\\.jsonc?$"

// SecretRef is the opaque Feature 007 SecretPort reference for a persisted secret value; never a plaintext value (Security, FR11).
#SecretRef: string & =~"^(?:[A-Za-z0-9._-]+:[^@]+(?:@v[1-9][0-9]*)?)?$"

// ReasonText is a bounded, secret-free explanation carried on a typed capability-gap or conflict envelope (FR14, Security).
#ReasonText: string & !~"^$"

// Iso8601 is the ISO-8601 timestamp of the last persisted mutation (FR4).
#Iso8601: string & =~"^[0-9]{4}-[0-9]{2}-[0-9]{2}T"

// DisplayLabel is the human label shown for a domain or verb row; never the raw dotted id (FR12).
#DisplayLabel: string & !~"^$"
</content>
