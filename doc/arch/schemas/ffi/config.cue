// DDD role: ValueObject
// Package: ffi.config
// The Feature 010 loader config, discovery outcome and content-free telemetry label sets
// (FR18, FR19, FR24, C1, C2, C14, C19). The native flags are the two experimental opt-in
// booleans — nativeTools and nativePty — both default false, so a present library changes
// nothing until the operator opts in (C2). The discovery outcome records the resolved ladder
// rung, the host platform, the selected backend and the typed gap reason (C1, C19). The
// telemetry label sets are bounded enums only: no file content, path, patch body, command
// string or session id is ever a label (FR24, ADR-0001, C14). Every shape is a ValueObject.

package ffi.config

import (
	"ffi/enums"
	"ffi/flags"
)

// NativeFlags are the two experimental opt-in booleans gating native tools and PTY, default false (FR19, C2).
#NativeFlags: {
	native_tools: flags.#NativeEnabled
	native_pty:   flags.#NativeEnabled
}

// DiscoveryOutcome records the resolved ladder rung, platform, selected backend and gap reason (FR18, C1, C19).
#DiscoveryOutcome: {
	platform:   enums.#Platform
	source:     enums.#DiscoverySource
	backend:    enums.#NativeToolBackend
	gap_reason: enums.#GapReason
}

// NativeTelemetryLabels is the bounded content-free label set for backend selection and the gap (FR24, C14).
#NativeTelemetryLabels: {
	tool:       enums.#TelemetryToolLabel
	backend:    enums.#NativeToolBackend
	gap_reason: enums.#GapReason
}

// PtyLifecycleLabels is the bounded content-free label set for PTY spawn/kill/close counters (FR24, C14).
#PtyLifecycleLabels: {
	event:   enums.#PtyLifecycleEvent
	backend: enums.#NativeToolBackend
}
