// DDD role: ValueObject
// Package: lifecycle.shared
// Shared identifier ValueObjects for the Feature 002 lifecycle engine.
// Centralised to avoid primitive obsession and duplicated constraints.
// Name parity with routing.shared ids is intentional; CUE packages are not
// cross-imported here, so the identifier concepts are re-declared locally.

package lifecycle.shared

// TaskId identifies the logical Task across all of its attempts.
#TaskId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ProcessId identifies one observable attempt/execution — never an OS PID (FR7).
#ProcessId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ParentProcessId references the parent attempt in the process tree.
#ParentProcessId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// RootProcessId references the root attempt of the authorized tree.
#RootProcessId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// SessionId identifies a Session; parity with routing.shared.#SessionId.
#SessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ParentSessionId references the direct parent Session.
#ParentSessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// RootSessionId references the authorized root-session tree.
#RootSessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// RuntimeInstanceId identifies the runtime that owns a process.
#RuntimeInstanceId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// LeaseId identifies an in-memory watchdog lease (never PID, never SQLite-per-beat).
#LeaseId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// EventId is the EventV2 evt_ identifier assigned per published event.
#EventId: string & =~"^evt_[A-Za-z0-9_-]{1,120}$"
