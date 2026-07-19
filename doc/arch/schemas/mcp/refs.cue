// DDD role: ValueObject
// Package: mcp.shared
// Cross-reference, secret and principal ValueObjects. Every axis carries an opaque
// handle only; a credential is a Feature 007 SecretPort secret ref, never raw material
// (FR32, C15), and a content handle is a Feature 005 OutputRef, never a filesystem path
// (FR34, C16). A process ref points at a Feature 002 Process Table child, never an OS
// PID (FR39, C8). No axis is a filesystem path (FR34, C16).

package mcp.shared

// SecretRef is a Feature 007 SecretPort secure reference — never raw secret material (FR32, C15).
#SecretRef: string & !~"^$"

// HeaderRef is a secure reference to an outbound auth header value — never inline (FR32, C15).
#HeaderRef: string & !~"^$"

// OperatorRef is the operator principal that granted an action; re-evaluated per action (FR48, C25).
#OperatorRef: string & !~"^$"

// PermissionRef references the runtime PermissionV2 profile gating a call/read (FR50, C10).
#PermissionRef: string & !~"^$"

// OutputRef is a Feature 005 OutputSpool content handle for a spooled body — never a path (FR34, C16).
#OutputRef: string & !~"^$"

// GroupId references the Feature 005 OutputGroup created per call/read (FR33, C16).
#GroupId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ProcessId references the Feature 002 Process Table child — never an OS PID (FR39, C8).
#ProcessId: string & =~"^[A-Za-z0-9_-]{1,128}$"
