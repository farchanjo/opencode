// DDD role: ValueObject
// Package: ffi.shared
// Shared boolean-flag ValueObjects for the Feature 010 FFI payloads and config (FR1, FR2,
// FR3, FR9, FR19, C2, C12). The truncated flag reports a size-capped read page or glob
// result; replace-all requests substitution of every edit occurrence; exited reports a
// non-blocking wait outcome; created distinguishes a write that created versus overwrote its
// target; native-enabled is the experimental opt-in flag, default false, that gates the six
// tools and the PTY backend (C2). Grouped in ffi.shared and reached through the `flags`
// import alias. Every flag is a ValueObject (calisthenics).

package ffi.shared

// Truncated flags a size-capped read page or glob result (FR1, FR5, AC2).
#Truncated: bool

// ReplaceAll requests substitution of every exact edit occurrence (FR3, AC4).
#ReplaceAll: bool

// Exited flags a PTY child that has terminated at a non-blocking wait (FR9, C12).
#Exited: bool

// Created distinguishes a write that created its target from one that overwrote it (FR2, AC3).
#Created: bool

// NativeEnabled is an experimental opt-in flag gating a native backend, default false (FR19, C2).
#NativeEnabled: bool
