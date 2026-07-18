// DDD role: ValueObject
// Package: routing.shared
// Shared descriptive scalar ValueObjects for the routing schema.

package routing.shared

// CapabilityDimension names a single tool-capability dimension.
#CapabilityDimension: string & !~"^$"

// Scope is a granularity scope such as "provider/model/variant".
#Scope: string & !~"^$"

// Reason is a human-readable explanation string on a record.
#Reason: string

// Requirement describes what a task required from a candidate.
#Requirement: string

// PermissionMode names the active permission mode.
#PermissionMode: string & !~"^$"

// EscalationThreshold is a named structured escalation signal.
#EscalationThreshold: string & !~"^$"
