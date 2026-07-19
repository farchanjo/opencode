// DDD role: ValueObject
// Package: operator_capability_gaps.shared
// Bounded text, id, path, and version ValueObjects for the Feature 017 operator
// capability-gap closure. Every operator-surface value is a named type so no
// primitive is carried inline (wrap-primitives). The SecretRef is an opaque
// Feature 007 SecretPort reference — never a plaintext value; the MCP/semantic
// provider credentials carry only this reference (Security, FR11, FR18). No field
// here holds a secret, a raw MCP header, a spool page body, a Milvus endpoint
// credential, or a free-form command id.

package operator_capability_gaps.shared

// ServerId is the MCP server key the live-host reads and mutations target (FR1, FR3).
#ServerId: string & !~"^$"

// CommandId is the canonical dotted domain.operation catalog id, unchanged by this feature (FR17).
#CommandId: string & =~"^[a-z][a-z0-9]*(\\.[a-z0-9-]+)+$"

// AuthorityKey is the Config.Service or control-store authority a mutation targets (FR3, FR9).
#AuthorityKey: string & =~"^[a-z][a-z0-9:_-]*$"

// Version is the opaque settled token on a mutation envelope — a config CAS version or a control-store generation; never parsed by the TUI (FR3, FR9).
#Version: string & !~"^$"

// ChannelGeneration is the OutputSpool per-generation fencing token the production writer honors; a stale generation is rejected (FR6, FR10).
#ChannelGeneration: string & !~"^$"

// OutputRef is the content-free spool output reference a stat/read/follow/admin op targets; never a page body (FR7, FR8, FR9).
#OutputRef: string & !~"^$"

// MilvusEndpoint is the configured Milvus endpoint the binding dials under the url-guard SSRF policy; never surfaced with a credential (FR13, FR14).
#MilvusEndpoint: string & =~"^[a-z][a-z0-9+.-]*://"

// SecretRef is the opaque Feature 007 SecretPort reference for a persisted secret value; never a plaintext value (Security, FR11, FR18).
#SecretRef: string & =~"^(?:[A-Za-z0-9._-]+:[^@]+(?:@v[1-9][0-9]*)?)?$"

// ReasonText is a bounded, secret-free explanation carried on a typed capability-gap or conflict envelope (FR18, Security).
#ReasonText: string & !~"^$"

// DisplayLabel is the human label shown for a domain, verb, or edit field; never the raw dotted id or a raw payload (FR15, FR19).
#DisplayLabel: string & !~"^$"
