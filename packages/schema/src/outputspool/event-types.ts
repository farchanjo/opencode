export * as EventTypes from "./event-types"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/outputspool/event-types.cue (package
// outputspool.enums) one-to-one — the closed 11-member output.* content-plane
// vocabulary (C20). The output.* prefix is the Feature 005 content-plane event
// namespace on EventV2; it is DISTINCT from the Feature 007 output.* operator
// command domain (output.stat|read|follow|export|share|release|delete|purge|
// retention.set|quota.set); both are reserved (C19, C20).

// OutputEventType is the closed content-plane settlement + live vocabulary (FR4, C20, C22).
export const OutputEventType = Schema.Literals([
  "output.channel_sealed",
  "output.channel_aborted",
  "output.settlement_recorded",
  "output.reconciled",
  "output.generation_fenced",
  "output.group_released",
  "output.group_reclaimed",
  "output.chunk_appended",
  "output.backpressure_signalled",
  "output.admission_degraded",
  "output.unknown",
]).annotate({ identifier: "OutputSpoolEnums.OutputEventType" })
export type OutputEventType = typeof OutputEventType.Type
