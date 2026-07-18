export * as Watchdog from "./watchdog"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { EnumsObservation } from "./enums-observation"
import { Ids } from "./ids"
import { Values } from "./values"

// Mirrors doc/arch/schemas/lifecycle/watchdog.cue — a single shared bucketed
// sweeper holds in-memory lease and heartbeat state, never one timer per Task
// and never a per-heartbeat SQLite write (C12, FR38). Reconciliation is explicit
// and versioned; no zombie or crash auto-retries (C13, FR40).

// WatchdogLease is the in-memory lease and heartbeat for one process.
export const WatchdogLease = Schema.Struct({
  lease_id: Ids.LeaseId,
  process_id: Ids.ProcessId,
  runtime_instance_id: Ids.RuntimeInstanceId,
  last_heartbeat_at: DateTimeUtcFromMillis,
  expires_at: DateTimeUtcFromMillis,
}).annotate({ identifier: "LifecycleWatchdog.WatchdogLease" })
export type WatchdogLease = Schema.Schema.Type<typeof WatchdogLease>

// ZombieAssessment publishes owner-loss/zombie/unknown without claiming a
// provider stopped (C12).
export const ZombieAssessment = Schema.Struct({
  process_id: Ids.ProcessId,
  outcome: EnumsObservation.WatchdogOutcome,
  reason: Values.Reason,
}).annotate({ identifier: "LifecycleWatchdog.ZombieAssessment" })
export type ZombieAssessment = Schema.Schema.Type<typeof ZombieAssessment>

// ReconcileRecord captures a versioned reconciliation outcome. auto_retry is
// pinned false: reconciliation never re-executes effects (C13, FR40).
export const ReconcileRecord = Schema.Struct({
  process_id: Ids.ProcessId,
  outcome: EnumsObservation.WatchdogOutcome,
  from_version: Values.SchemaVersion,
  auto_retry: Schema.Literal(false),
}).annotate({ identifier: "LifecycleWatchdog.ReconcileRecord" })
export type ReconcileRecord = Schema.Schema.Type<typeof ReconcileRecord>
