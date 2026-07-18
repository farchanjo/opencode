// DDD role: ValueObject
// Package: routing.shared
// Shared version, timestamp and reference ValueObjects for the routing schema.

package routing.shared

// Version is a monotonic schema/record version.
#Version: uint & >=1

// CatalogVersion pins the capability catalog at decision time.
#CatalogVersion: string & !~"^$"

// PolicyVersion pins the routing policy at decision time.
#PolicyVersion: string & !~"^$"

// TodoRef references a Todo aggregate.
#TodoRef: string & !~"^$"

// TodoVersion pins a Todo aggregate revision.
#TodoVersion: string & !~"^$"

// Timestamp is an ISO 8601 instant.
#Timestamp: string & !~"^$"

// Fingerprint is a deterministic hash of task inputs for cache/replay dedup.
#Fingerprint: string & !~"^$"
