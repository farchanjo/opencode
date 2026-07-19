// DDD role: ValueObject
// Package: ffi.pty
// Cohesive sub-objects and first-class collections composed by the PTY session entity and
// its requests (FR8, FR9, C9, C11, C12). The spawn result is the single owning descriptor
// handed to Bun — session_id, pid and master_fd (C9). The window size carries the terminal
// columns and rows applied via TIOCSWINSZ (C12). The wait result is the non-blocking
// waitpid(WNOHANG) outcome — exited plus the exit code or terminating signal (C12). The argv
// and environment collections replace bare arrays for the spawn command line (calisthenics).
// Every shape is a ValueObject.

package ffi.pty

import (
	"ffi/ids"
	"ffi/values"
	"ffi/flags"
)

// PtySpawnResult is the oc_pty_spawn success payload; the master fd transfers wholly to Bun (FR8, C9).
#PtySpawnResult: {
	session_id: ids.#SessionId
	pid:        values.#Pid
	master_fd:  values.#FileDescriptor
}

// WindowSize carries the terminal columns and rows applied via TIOCSWINSZ (FR9, C12).
#WindowSize: {
	cols: values.#TermDimension
	rows: values.#TermDimension
}

// PtyWaitResult is the non-blocking waitpid(WNOHANG) outcome: exited plus code or signal (FR9, C12).
#PtyWaitResult: {
	exited:    flags.#Exited
	exit_code: values.#ExitCode | null
	signal:    values.#SignalNumber | null
}

// CommandArgv is the first-class collection of PTY command arguments (FR8, C11).
#CommandArgv: [...ids.#CommandArg]

// EnvEntry is one PTY environment variable name and value (FR8).
#EnvEntry: {
	name:  ids.#EnvName
	value: ids.#EnvValue
}

// EnvEntrySet is the first-class collection of PTY environment variables (FR8).
#EnvEntrySet: [...#EnvEntry]
