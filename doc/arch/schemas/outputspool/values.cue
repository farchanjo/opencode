// DDD role: ValueObject
// Package: outputspool.shared
// Byte-offset, length, ordering and version counter ValueObjects. The canonical
// offset unit is uncompressed bytes (FR20, C15); committed length is the recovery
// authority owned by the control store, never re-authored here (FR25, C12). Bounds
// are provisional plan constants with named acceptance hooks (C3).

package outputspool.shared

// ByteOffset is a zero-based uncompressed byte position; the canonical read unit (FR20, C15).
#ByteOffset: uint & >=0

// ByteLength is a bounded uncompressed byte count (FR20, C3).
#ByteLength: uint & >=0

// CommittedBytes is the control-store committed-length authority for a generation (FR25, C12).
#CommittedBytes: uint & >=0

// NextOffset is the byte offset a follow read resumes from (FR21, AC4).
#NextOffset: uint & >=0

// PageLimit is the mandatory server-capped read page limit; provisional 1 MiB cap (FR20, C3, AC1).
#PageLimit: uint & >=1

// QueueDepthBytes bounds the per-writer async queue; provisional cap (FR8, C3, AC5).
#QueueDepthBytes: uint & >=0

// Sequence is per-aggregate ordering of a durable output.* event; no global order (C20).
#Sequence: uint & >=0

// SchemaVersion mirrors the EventV2 durable.version counter (C20).
#SchemaVersion: uint & >=1

// Generation is the fencing generation; a new generation never overwrites its predecessor (FR14, FR27, C18).
#Generation: uint & >=0

// Attempt is the 1-based attempt index owned by the Feature 002 executor (C21).
#Attempt: uint & >=1
