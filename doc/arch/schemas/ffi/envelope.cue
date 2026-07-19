// DDD role: ValueObject
// Package: ffi.envelope
// The Feature 010 FFI response envelope and version handshake (FR14, FR15, FR16, C3, C7,
// C16, C18). Every extern "C" oc_<name> entry point returns #FfiResponse: success carries
// `result`, failure carries the typed #FfiError, discriminated by `status`; `ok` is read as
// `status == "ok"` (C3). A caught panic is serialized as status "error" with code
// internal_panic and a generic message — it never unwinds across the boundary and never
// carries a backtrace, pointer or address (FR16, C3). The handshake exposes the ABI version,
// the semver and the introspected parity caps so the duplicated Rust constants stay
// test-locked to the TypeScript source of truth (C7, C16); oc_alloc_stats backs the
// leak-freedom assertion (C18). Every shape is a ValueObject.

package ffi.envelope

import (
	"ffi/enums"
	"ffi/ids"
	"ffi/values"
	"ffi/counters"
)

// FfiError is the typed error payload returned when status is "error" (FR15, C4).
#FfiError: {
	code:    enums.#FfiErrorCode
	message: ids.#ErrorMessage
}

// FfiResult is the tool-specific success payload; each tool narrows it to its result shape (FR14).
#FfiResult: {...}

// FfiResponse is the JSON envelope every entry point returns, discriminated by status (FR14, C3).
#FfiResponse: {
	status: enums.#FfiStatus
	if status == "ok" {
		result?: #FfiResult
	}
	if status == "error" {
		error: #FfiError
	}
}

// AbiCaps are the introspected read caps surfaced by oc_version, test-locked to TypeScript (C7, C16).
#AbiCaps: {
	max_read_lines:         counters.#LineCount
	max_read_bytes:         values.#ByteCount
	max_line_length:        counters.#LineCount
	max_media_ingest_bytes: values.#ByteCount
}

// FfiVersion is the oc_version handshake payload: ABI major, semver and introspected caps (FR14, C7).
#FfiVersion: {
	abi_version: values.#AbiVersion
	semver:      ids.#SemVer
	caps:        #AbiCaps
}

// AllocStats is the debug-gated oc_alloc_stats payload; allocated equals freed at rest (FR17, C18).
#AllocStats: {
	allocated: counters.#AllocationCount
	freed:     counters.#FreeCount
}
