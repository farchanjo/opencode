// DDD role: ValueObject
// Package: ffi.shared
// Shared identity and bounded-text ValueObjects for the Feature 010 FFI request/response
// payloads (FR1-FR6, FR8, C3, C9). Centralised to avoid primitive obsession and duplicated
// constraints across the tool and PTY payloads. A file path is a request axis the tools
// already operate on — never a telemetry label (FR24, C14). The session id is the opaque,
// non-guessable handle oc_pty_spawn mints and the TypeScript registry keys (FR8, C10). The
// semver is the oc_version handshake string (FR14, C7). Numeric axes live in values.cue and
// counters.cue; boolean flags in flags.cue; free-form content and pattern text in
// text-values.cue. No axis is a secret.

package ffi.shared

// FilePath is the destination or search-root path a native tool operates on (FR1-FR6).
#FilePath: string & !=""

// SessionId is the opaque non-guessable PTY handle minted by oc_pty_spawn (FR8, C10).
#SessionId: string & !=""

// SemVer is the semantic version string returned by the oc_version handshake (FR14, C7).
#SemVer: string & =~"^[0-9]+\\.[0-9]+\\.[0-9]+$"
