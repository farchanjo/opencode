// DDD role: Entity
// Package: ffi.pty
// PtySessionEntry — one live PTY session in the TypeScript-side registry (FR8, FR9, C9,
// C10). It is an Entity: its identity is the opaque, non-guessable session_id oc_pty_spawn
// mints, stable across every resize/kill/wait/close call that passes it (C10). The registry
// is the single owner of each session's lifecycle handles and guarantees the single-owner fd
// contract — the master fd is closed exactly once, by Bun, its owner (C9). The pgid is the
// child session-leader group oc_pty_kill signals so the full process tree is terminated with
// no orphans (FR9, NFR5, C11, C12). Cohesive parts live in session-parts.cue.

package ffi.pty

import (
	"ffi/ids"
	"ffi/values"
)

// PtySessionEntry is the registry entry keyed by session_id owning one PTY lifecycle (FR8, C10).
#PtySessionEntry: {
	id:        ids.#SessionId
	pid:       values.#Pid
	master_fd: values.#FileDescriptor
	pgid:      values.#ProcessGroupId
}
