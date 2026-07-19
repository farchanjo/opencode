// DDD role: ValueObject
// Package: ffi.tools
// Cohesive sub-objects and first-class collections composed by the grep and glob results
// (FR5, FR6, C13). One grep match carries the file path, its 1-based line number, the
// absolute byte offset and the matched line text; the collections replace bare arrays for the
// match set, the glob path set and the per-file count set (calisthenics). The byte offset is
// the deterministic secondary tie-break key so only ties the reference leaves undefined are
// normalized before the byte-identical comparison (C13, AC7). No sub-object is a telemetry
// label (FR24, C14). Every shape is a ValueObject.

package ffi.tools

import (
	"ffi/ids"
	"ffi/values"
	"ffi/counters"
)

// GrepMatch is one content-mode match: path, 1-based line, absolute byte offset and text (FR6, C13).
#GrepMatch: {
	path:        ids.#FilePath
	line_number: values.#LineNumber
	byte_offset: values.#ByteOffset
	text:        ids.#FileContent
}

// GrepMatchSet is the first-class collection of content-mode grep matches (FR6, AC7).
#GrepMatchSet: [...#GrepMatch]

// GlobPathSet is the first-class collection of matched file paths for glob and files-with-matches (FR5, FR6, AC6).
#GlobPathSet: [...ids.#FilePath]

// GrepFileCount is one count-mode entry: a file path and its match count (FR6, AC7).
#GrepFileCount: {
	path:  ids.#FilePath
	count: counters.#MatchCount
}

// GrepFileCountSet is the first-class collection of count-mode per-file counts (FR6, AC7).
#GrepFileCountSet: [...#GrepFileCount]
