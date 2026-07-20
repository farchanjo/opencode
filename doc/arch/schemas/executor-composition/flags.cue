// DDD role: ValueObject
// Package: executor_composition.flags
// Named boolean ValueObjects for the Feature 018 executor composition. Each flag
// is a named type so no bare bool is carried inline (wrap-primitives); they record
// whether the eager arming succeeded, whether the composition reused the shared
// spool writer, whether a scheduled session ran under the same permission surface
// as a normal session (no privilege bypass), and whether the interrupt registry
// held an entry for the forced-abort target.

package executor_composition.flags

// EagerArmed is true when the process-singleton composition armed at server start; false is the fail-open disarmed state (FR1, FR2).
#EagerArmed: bool

// SharedSpoolWriter is true when the coordinator captured occurrence output through the SAME Feature 017 spool writer, never a second writer (FR5).
#SharedSpoolWriter: bool

// SamePermissionSurface is true when the scheduled session ran under the identical permission/config surface as a normal session; no privilege bypass (FR6).
#SamePermissionSurface: bool

// InterruptRegistered is true when the execution layer registered the active root run into the narrow interrupt registry the operator consults (FR9).
#InterruptRegistered: bool
