// DDD role: ValueObject
// Package: lifecycle.watchdog
// A single shared bucketed sweeper holds in-memory lease and heartbeat state —
// never one timer per Task, never a per-heartbeat SQLite write (C12, FR38).
// Reconciliation is explicit and versioned; no zombie or crash auto-retries (C13).

package lifecycle.watchdog

import (
	"lifecycle/ids"
	"lifecycle/enums"
)

// AutoRetryDisabled is pinned false: reconciliation never re-executes effects (C13, FR40).
#AutoRetryDisabled: false

// WatchdogLease is the in-memory lease and heartbeat for one process.
#WatchdogLease: {
	lease_id:            ids.#LeaseId
	process_id:          ids.#ProcessId
	runtime_instance_id: ids.#RuntimeInstanceId
	last_heartbeat_at:   ids.#Timestamp
	expires_at:          ids.#Timestamp
}

// ZombieAssessment publishes owner-loss/zombie/unknown without claiming a provider stopped (C12).
#ZombieAssessment: {
	process_id: ids.#ProcessId
	outcome:    enums.#WatchdogOutcome
	reason:     ids.#Reason
}

// ReconcileRecord captures a versioned reconciliation outcome with no auto-retry.
#ReconcileRecord: {
	process_id:   ids.#ProcessId
	outcome:      enums.#WatchdogOutcome
	from_version: ids.#SchemaVersion
	auto_retry:   #AutoRetryDisabled
}
