// DDD role: ValueObject
// Package: semantic.shared
// Version, dimension and window numeric ValueObjects. An embedding dimension,
// normalization and metric are stored with the collection generation and never
// inferred (FR12, C12); incompatible vectors are never mixed in one search space
// (FR12). Byte offset/limit reach a sanitized chunk body through a Feature 005 ref,
// never an inline body (FR40, C9). Bounds are provisional plan constants (C7, C8).

package semantic.shared

// BindingVersion is the immutable version counter of a SemanticModelBinding (FR28, FR31, C12).
#BindingVersion: uint & >=1

// SchemaVersion mirrors the EventV2 durable.version counter on a semantic.* event (C22).
#SchemaVersion: uint & >=1

// ConfigVersion is the config generation a binding/cache was resolved under (FR25, C10).
#ConfigVersion: uint & >=1

// Dimension is the stored embedding dimensionality of a collection generation (FR12, C7).
#Dimension: uint & >=1

// Sequence is per-aggregate ordering of a durable semantic.* event; no global order (C22).
#Sequence: uint & >=0

// ByteOffset is a zero-based offset into a Feature 005 chunk body ref (FR40, C9).
#ByteOffset: uint & >=0

// ByteLimit is the bounded page length read from a Feature 005 chunk body ref (FR40, C9).
#ByteLimit: uint & >=1

// ChunkIndex is the zero-based position of a chunk within its parent skill body (FR11, C9).
#ChunkIndex: uint & >=0

// ChunkOverlap is the fixed token overlap between adjacent chunks; plan constant (FR11, C9, AC12).
#ChunkOverlap: uint & >=0
