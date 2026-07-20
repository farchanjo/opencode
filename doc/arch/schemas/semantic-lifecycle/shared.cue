// DDD role: ValueObject
// Package: semantic_lifecycle.shared
// Bounded string ValueObjects for Feature 019 — every operator-surface value is a
// named type so no primitive is carried inline (wrap-primitives). No field here
// holds a prompt, an embedding vector body, a session transcript, a secret, an OTLP
// signal body, or a raw config fragment; a provider/Milvus/collector credential is a
// SecretRef only, resolved at use time and never persisted or logged in plaintext
// (Security). CUE packages are not cross-resolved by the structural reader; import
// paths mirror the executor-composition corpus style.

package semantic_lifecycle.shared

// CommandId is the canonical dotted domain.operation catalog id, unchanged by this feature — Feature 007 stays the sole registration authority (FR-INV).
#CommandId: string & =~"^[a-z][a-z0-9]*(\\.[a-z0-9-]+)+$"

// CasToken is the opaque compare-and-swap token an activation/rollback presents; a contention swaps nothing (Group A, Group B).
#CasToken: string & !~"^$"

// ReasonText is a bounded, secret-free explanation carried on a typed capability-gap, denial, gate-refusal, or conflict envelope (FR-INV, Security).
#ReasonText: string & !~"^$"

// ModelRef is the pinned embedding/reranker model descriptor id carried unchanged across every transition; a degrade NEVER substitutes another model (Group A, Group B).
#ModelRef: string & !~"^$"

// SecretRef is the opaque reference to a provider/Milvus/collector credential; the plaintext secret never crosses a seam or an envelope (Security).
#SecretRef: string & !~"^$"

// EndpointAddress is the bounded host:port target of a Milvus endpoint or an OTLP collector; a bare finding or typed gap crosses the seam, never the address' credential (Group B, Group D).
#EndpointAddress: string & !~"^$"
