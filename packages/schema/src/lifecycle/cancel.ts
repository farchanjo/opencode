export * as Cancel from "./cancel"

import { Schema } from "effect"
import { EnumsObservation } from "./enums-observation"
import { Ids } from "./ids"
import { Values } from "./values"

// Mirrors doc/arch/schemas/lifecycle/cancel.cue — root-tree cancellation is a
// request, not a mutation (C17). It propagates through the canonical
// SessionRunCoordinator root scope, fences descendant admission, and never
// promises remote kill, reversal, or mutation rollback (FR41, FR62).

// RootCancelScope identifies the authorized root tree targeted by Ctrl+C. A
// second press within the escalation window forces a local abort (C17).
export const RootCancelScope = Schema.Struct({
  root_session_id: Ids.RootSessionId,
  root_process_id: Ids.RootProcessId,
  press: Schema.Literals(["first", "second"]),
}).annotate({ identifier: "LifecycleCancel.RootCancelScope" })
export type RootCancelScope = Schema.Schema.Type<typeof RootCancelScope>

// CancelRequestRecord records the request outcome and fencing; no remote kill
// is promised (C17). fenced_descendants is true once new descendants of the root
// are quarantined (AC30).
export const CancelRequestRecord = Schema.Struct({
  scope: RootCancelScope,
  outcome: EnumsObservation.CancelOutcome,
  fenced_descendants: Schema.Boolean,
  reason: Values.Reason,
}).annotate({ identifier: "LifecycleCancel.CancelRequestRecord" })
export type CancelRequestRecord = Schema.Schema.Type<typeof CancelRequestRecord>
