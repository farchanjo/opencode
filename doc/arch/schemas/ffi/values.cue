// DDD role: ValueObject
// Package: ffi.shared
// Shared numeric ValueObjects for the Feature 010 FFI payloads (FR1, FR8, FR9, FR14, C7,
// C9, C12). Centralised to avoid primitive obsession: the process id, the master file
// descriptor Bun owns single-writer, the process-group id kill signals, the ABI version the
// handshake compares, the 1-based line number and byte offset the read/grep windows use, the
// bounded exit code and signal number from a waited PTY child, and the terminal window
// dimension. Monotonic count axes live in counters.cue. No axis is a filesystem path or a
// telemetry label (FR24, C14). Every value is a ValueObject.

package ffi.shared

// Pid is the child process id returned by oc_pty_spawn (FR8, C9).
#Pid: int & >0

// FileDescriptor is the PTY master fd Bun owns single-writer after spawn (FR8, FR10, C9).
#FileDescriptor: int & >=0

// ProcessGroupId is the child session-leader pgid oc_pty_kill signals (FR9, C11, C12).
#ProcessGroupId: int & >0

// AbiVersion is the u32 ABI major the loader compares on the handshake (FR14, C7).
#AbiVersion: int & >=0

// LineNumber is a 1-based line position for read windowing and grep matches (FR1, FR6, C16).
#LineNumber: int & >=1

// ByteCount is a non-negative byte size for read/write caps and payloads (FR1, FR2, C16).
#ByteCount: int & >=0

// ByteOffset is a non-negative absolute byte offset of a grep match (FR6, C13).
#ByteOffset: int & >=0

// ExitCode is the bounded process exit status from oc_pty_wait (FR9, C12).
#ExitCode: int & >=0 & <=255

// SignalNumber is the signal delivered to a PTY process group (FR9, C12).
#SignalNumber: int & >0

// TermDimension is a positive terminal column or row count for resize (FR9, C12).
#TermDimension: int & >0
