// DDD role: ValueObject
// Package: ffi.shared
// Bounded free-form text ValueObjects for the Feature 010 tool and PTY payloads (FR1-FR6,
// FR8, C4, C16). These are the content and pattern axes the native tools already process at
// parity with the TypeScript references — file bytes read/written, the exact edit target and
// replacement, the multi-hunk patch body, the glob/grep patterns, one command argument, and
// one environment name/value. The error message is the human-readable half of the typed
// #FfiError; a caught panic yields a generic message with no backtrace, pointer or address
// (FR15, C3). None of these axes is ever a telemetry label (FR24, C14). Grouped in
// ffi.shared and reached through the `ids` import alias like the identity axes.

package ffi.shared

// FileContent is the UTF-8 file body a tool reads or writes; empty is valid (FR1, FR2).
#FileContent: string

// EditTarget is the exact string an edit replaces; it is non-empty (FR3, AC4).
#EditTarget: string & !=""

// EditReplacement is the substitute string; it differs from the edit target (FR3, AC4).
#EditReplacement: string

// PatchText is the multi-hunk patch body applied by apply_patch (FR4, AC5).
#PatchText: string & !=""

// SearchPattern is the grep regular-expression pattern (FR6, AC7).
#SearchPattern: string & !=""

// GlobPattern is the glob file-match pattern honoring .gitignore (FR5, AC6).
#GlobPattern: string & !=""

// ErrorMessage is the human-readable half of a typed #FfiError; generic on panic (FR15, C3).
#ErrorMessage: string & !=""

// CommandArg is one argument of the PTY command line, argv element or program (FR8, C11).
#CommandArg: string & !=""

// EnvName is one PTY environment-variable name (FR8).
#EnvName: string & !=""

// EnvValue is one PTY environment-variable value; empty is valid (FR8).
#EnvValue: string
