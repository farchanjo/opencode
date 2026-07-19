// DDD role: ValueObject
// Package: ffi.pty
// The five PTY entry-point request payloads carried in the oc_pty_* JSON request buffer
// (FR8, FR9, C11, C12). Spawn carries the command, argv, working directory, environment and
// initial window; resize carries the new window; kill carries the signal delivered to the
// process group; wait and close carry the session id alone. The permission gate is evaluated
// in TypeScript before oc_pty_spawn — no request field carries or caches a permission
// decision (FR13, C20). Each Rust call performs exactly one syscall; the 3-second SIGKILL
// escalation timer lives in TypeScript (C12). Every request is a ValueObject.

package ffi.pty

import (
	"ffi/ids"
	"ffi/values"
)

// PtySpawnRequest carries the command line, working dir, environment and initial window (FR8, C11).
#PtySpawnRequest: {
	command: ids.#CommandArg
	args:    #CommandArgv
	cwd:     ids.#FilePath | null
	env:     #EnvEntrySet
	window:  #WindowSize
}

// PtyResizeRequest carries the session id and the new terminal window size (FR9, C12).
#PtyResizeRequest: {
	session_id: ids.#SessionId
	window:     #WindowSize
}

// PtyKillRequest carries the session id and the signal delivered to the process group (FR9, C12).
#PtyKillRequest: {
	session_id: ids.#SessionId
	signal:     values.#SignalNumber
}

// PtyWaitRequest carries the session id for a non-blocking waitpid(WNOHANG) (FR9, C12).
#PtyWaitRequest: {
	session_id: ids.#SessionId
}

// PtyCloseRequest carries the session id for idempotent single-owner teardown (FR9, C9, C12).
#PtyCloseRequest: {
	session_id: ids.#SessionId
}
