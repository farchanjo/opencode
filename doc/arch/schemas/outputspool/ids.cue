// DDD role: ValueObject
// Package: outputspool.shared
// Shared identity ValueObjects for the Feature 005 OutputSpool content plane.
// Centralised to avoid primitive obsession and duplicated constraints. Name
// parity with lifecycle.shared / jobs.shared / langlock.shared is intentional;
// CUE packages are not cross-imported here, so the identifier concepts are
// re-declared locally (Feature 005 C1, C18, C21).

package outputspool.shared

// GroupId identifies one OutputGroup aggregate — one generation subtree (FR14, C1, C18).
#GroupId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// OutputRef is a bounded opaque channel/artifact handle — never a path, never a saved permission (FR12, FR17, FR48, C18).
#OutputRef: string & !~"^$"

// ChannelId identifies one typed channel within a group (FR15).
#ChannelId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ProcessId references the Feature 002 Task Process that owns the group — never an OS PID (FR14, C21).
#ProcessId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// RootSessionId references the authorized root-session tree the group is keyed under (FR11, C1).
#RootSessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// SessionId identifies the producing Session; parity with lifecycle.shared.#SessionId.
#SessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ProjectId references the project scope the spool tree is keyed under (FR11, C1).
#ProjectId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// EventId is the EventV2 evt_ identifier assigned per published output.* event (C20).
#EventId: string & =~"^evt_[A-Za-z0-9_-]{1,120}$"

// LeaseId identifies one retention lease held against a group (FR28, C5).
#LeaseId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// HolderRef is an opaque holder handle for a lease or reference edge (FR28, C5).
#HolderRef: string & !~"^$"
