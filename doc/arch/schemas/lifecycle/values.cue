// DDD role: ValueObject
// Package: lifecycle.shared
// Ordering, version and fanout counter ValueObjects for the lifecycle engine.

package lifecycle.shared

// Sequence is per-aggregate ordering; no global order is implied (FR10, C8).
#Sequence: uint & >=0

// Attempt is the 1-based attempt index of a task_id (C8).
#Attempt: uint & >=1

// Generation is the fencing generation for handoff and reconciliation (C8, C16).
#Generation: uint & >=0

// SchemaVersion mirrors the EventV2 durable.version counter (C4).
#SchemaVersion: uint & >=1

// DelegationDepth is 0 at the root; Architect -> Manager -> Worker = depth 2 (C15).
#DelegationDepth: uint & >=0

// FanoutCount counts requested or granted worker fanout (C11).
#FanoutCount: uint & >=0

// ItemCount is a bounded Todo item count observed by the row (C23).
#ItemCount: uint & >=0

// Fanout pairs requested versus granted worker concurrency (C11, FR31).
#Fanout: {
	requested: #FanoutCount
	granted:   #FanoutCount
}
