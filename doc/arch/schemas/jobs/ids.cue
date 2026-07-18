// DDD role: ValueObject
// Package: jobs.shared
// Shared identity ValueObjects for the Feature 003 scheduled-jobs engine.
// Centralised to avoid primitive obsession and duplicated constraints. Name
// parity with lifecycle.shared / routing.shared is intentional; CUE packages
// are not cross-imported here, so the identifier concepts are re-declared
// locally (Feature 003 C1, C6, C16).

package jobs.shared

// JobDefinitionId identifies a durable Job Definition aggregate (FR1, FR2).
#JobDefinitionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ScheduleId identifies one schedule bound to a Job Definition (FR1).
#ScheduleId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// OccurrenceId identifies one logical trigger occurrence (FR1, FR10).
#OccurrenceId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ProcessId identifies the Feature 002 Task Process for an occurrence — never an OS PID (FR1, C16).
#ProcessId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// RootProcessId references the root attempt of the authorized tree.
#RootProcessId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// SessionId identifies the occurrence Session; parity with lifecycle.shared.#SessionId.
#SessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ParentSessionId references the direct parent Session.
#ParentSessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// RootSessionId references the authorized root-session tree (FR1, FR21).
#RootSessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// NotificationId identifies one notification envelope (FR22).
#NotificationId: string & =~"^ntf_[A-Za-z0-9_-]{1,120}$"

// EventId is the EventV2 evt_ identifier assigned per published job.* event (C8).
#EventId: string & =~"^evt_[A-Za-z0-9_-]{1,120}$"
