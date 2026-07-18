// DDD role: ValueObject
// Package: outputspool.enums
// OutputEventType — the closed output.* event vocabulary registered through
// EventV2.define into the durable-event manifest (C20). The output.* prefix is the
// Feature 005 content-plane event namespace on EventV2, distinct from the Feature
// 007 output.* operator command domain (output.stat|read|follow|export|share|
// release|delete|purge|retention.set|quota.set); both are reserved (C19, C20).

package outputspool.enums

// OutputEventType is the closed content-plane settlement + live vocabulary (FR4, C20, C22).
#OutputEventType: "output.channel_sealed" | "output.channel_aborted" | "output.settlement_recorded" | "output.reconciled" | "output.generation_fenced" | "output.group_released" | "output.group_reclaimed" | "output.chunk_appended" | "output.backpressure_signalled" | "output.admission_degraded" | "output.unknown"
