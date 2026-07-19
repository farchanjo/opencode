// DDD role: ValueObject
// Package: ffi.tools
// The six native tool request payloads carried in the oc_<name> JSON request buffer
// (FR1-FR6, FR14, C4, C16). Each mirrors the existing TypeScript tool input schema field for
// field so the native backend is transparent to callers and to the model (FR18, C8): read
// windows by 1-based offset and limit; write carries the create/overwrite content; edit
// carries the exact target, its replacement and the replace-all flag; apply_patch carries
// the multi-hunk body; glob and grep carry the pattern plus optional root and bounds. Text
// axes are reached through the `ids` alias. Every request is a ValueObject.

package ffi.tools

import (
	"ffi/ids"
	"ffi/values"
	"ffi/counters"
	"ffi/flags"
	"ffi/enums"
)

// ReadRequest windows a file by optional 1-based offset and limit at parity with read-filesystem.ts (FR1, C16).
#ReadRequest: {
	path:   ids.#FilePath
	offset: values.#LineNumber | null
	limit:  counters.#LineCount | null
}

// WriteRequest carries the create/overwrite content written atomically to the target (FR2, AC3).
#WriteRequest: {
	path:    ids.#FilePath
	content: ids.#FileContent
}

// EditRequest carries the exact target, its replacement and the replace-all flag (FR3, AC4).
#EditRequest: {
	path:        ids.#FilePath
	old_string:  ids.#EditTarget
	new_string:  ids.#EditReplacement
	replace_all: flags.#ReplaceAll
}

// ApplyPatchRequest carries the multi-hunk patch body applied against surrounding context (FR4, AC5).
#ApplyPatchRequest: {
	patch: ids.#PatchText
	cwd:   ids.#FilePath | null
}

// GlobRequest carries the .gitignore-honoring glob pattern plus optional root and result bound (FR5, AC6).
#GlobRequest: {
	pattern: ids.#GlobPattern
	cwd:     ids.#FilePath | null
	limit:   counters.#PathCount | null
}

// GrepRequest carries the pattern, output mode and optional root, glob filter and context (FR6, AC7).
#GrepRequest: {
	pattern:       ids.#SearchPattern
	path:          ids.#FilePath | null
	mode:          enums.#GrepOutputMode
	glob:          ids.#GlobPattern | null
	context_lines: values.#LineNumber | null
}
