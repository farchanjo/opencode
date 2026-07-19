// DDD role: ValueObject
// Package: ffi.tools
// The six native tool result payloads carried in the #FfiResponse `result` on success
// (FR1-FR7, C13, C16). Each is structurally and byte-identical to the TypeScript reference
// output on the shared fixtures, ignoring only ordering ties the references leave undefined
// (FR7, NFR1, C13). Read reports the page content, its size, the truncation flag and the next
// continuation cursor; write reports create-versus-overwrite and bytes written; edit reports
// the substitution count; apply_patch reports files changed and hunks applied; glob and grep
// report their mode-specific collections defined in tool-result-parts.cue. Every result is a
// ValueObject.

package ffi.tools

import (
	"ffi/ids"
	"ffi/values"
	"ffi/counters"
	"ffi/flags"
	"ffi/enums"
)

// ReadResult is the paged read output: content, size, truncation flag and continuation cursor (FR1, AC2).
#ReadResult: {
	content:    ids.#FileContent
	line_count: counters.#LineCount
	byte_count: values.#ByteCount
	truncated:  flags.#Truncated
	next:       values.#LineNumber | null
}

// WriteResult reports whether the atomic write created or overwrote the target and its size (FR2, AC3).
#WriteResult: {
	created:    flags.#Created
	byte_count: values.#ByteCount
}

// EditResult reports the number of exact substitutions applied (FR3, AC4).
#EditResult: {
	replacements: counters.#ReplacementCount
}

// ApplyPatchResult reports the files changed and hunks applied on a full match (FR4, AC5).
#ApplyPatchResult: {
	files_changed: counters.#PathCount
	hunks_applied: counters.#HunkCount
}

// GlobResult is the mtime-desc-sorted path set with a size-cap truncation flag (FR5, AC6).
#GlobResult: {
	paths:     #GlobPathSet
	truncated: flags.#Truncated
}

// GrepResult carries the output mode and exactly the mode-specific collection populated (FR6, AC7).
#GrepResult: {
	mode:    enums.#GrepOutputMode
	matches: #GrepMatchSet | null
	files:   #GlobPathSet | null
	counts:  #GrepFileCountSet | null
}
