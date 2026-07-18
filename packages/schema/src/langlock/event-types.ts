export * as EventTypes from "./event-types"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/langlock/event-types.cue (package langlock.enums)
// one-to-one — the closed 15-member langlock.* event vocabulary (C8). The
// langlock.* prefix is the Feature 004 audit/advisory event namespace on
// EventV2; it is DISTINCT from the Feature 007 langlock.* operator command
// domain (langlock.status|show|set|reset); both are reserved (C3, C8).

// LangLockEventType is the closed langlock.* vocabulary registered through EventV2.define (C8).
export const LangLockEventType = Schema.Literals([
  "langlock.policy_set",
  "langlock.policy_reset",
  "langlock.override_authorized",
  "langlock.override_denied",
  "langlock.exception_registered",
  "langlock.exception_revoked",
  "langlock.policy_injected",
  "langlock.policy_reapplied",
  "langlock.envelope_stamped",
  "langlock.advisory_flagged",
  "langlock.advisory_acknowledged",
  "langlock.advisory_suppressed",
  "langlock.detector_unknown",
  "langlock.resolution_retained",
  "langlock.unknown",
]).annotate({ identifier: "LangLockEnums.LangLockEventType" })
export type LangLockEventType = typeof LangLockEventType.Type
