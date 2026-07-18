export * as Admission from "./admission"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../schema"
import { EnumsObservation } from "./enums-observation"
import { UsageValues } from "./usage-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/lifecycle/admission.cue — per-scope token-bucket
// admission over measured capacity with hard ceilings and no unbounded queue
// (C11, FR30, FR34). The projection and observers never call admission; these
// are the admission service's own state and its projected outcome.

// CapacitySignals hold measured saturation in [0.0, 1.0] per capacity source (FR2).
export const CapacitySignals = Schema.Struct({
  cpu_saturation: UsageValues.Confidence,
  mem_saturation: UsageValues.Confidence,
  provider_saturation: UsageValues.Confidence,
  sqlite_saturation: UsageValues.Confidence,
  event_queue_saturation: UsageValues.Confidence,
  otel_queue_saturation: UsageValues.Confidence,
}).annotate({ identifier: "LifecycleAdmission.CapacitySignals" })
export type CapacitySignals = Schema.Schema.Type<typeof CapacitySignals>

// TokenBucketState holds the hard ceiling and current fill; never relaxed by a
// model (FR34).
export const TokenBucketState = Schema.Struct({
  capacity: PositiveInt,
  available: NonNegativeInt,
  refill_per_second: PositiveInt,
}).annotate({ identifier: "LifecycleAdmission.TokenBucketState" })
export type TokenBucketState = Schema.Schema.Type<typeof TokenBucketState>

// AdmissionBucket is one scope's token bucket and fence state. fenced is true
// after a root cancel quarantines the scope (C17, AC30).
export const AdmissionBucket = Schema.Struct({
  scope: EnumsObservation.AdmissionScope,
  bucket: TokenBucketState,
  fenced: Schema.Boolean,
}).annotate({ identifier: "LifecycleAdmission.AdmissionBucket" })
export type AdmissionBucket = Schema.Schema.Type<typeof AdmissionBucket>

// AdmissionResult projects a granted/partial/queued/rejected outcome with the
// requested-versus-granted fanout (C11, FR31).
export const AdmissionResult = Schema.Struct({
  scope: EnumsObservation.AdmissionScope,
  decision: EnumsObservation.AdmissionDecision,
  fanout: Schema.Struct({ requested: Values.FanoutCount, granted: Values.FanoutCount }),
  reason: Values.Reason,
}).annotate({ identifier: "LifecycleAdmission.AdmissionResult" })
export type AdmissionResult = Schema.Schema.Type<typeof AdmissionResult>
