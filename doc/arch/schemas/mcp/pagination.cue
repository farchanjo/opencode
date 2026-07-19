// DDD role: ValueObject
// Package: mcp.tools
// Cursor-pagination ValueObjects for the tools/list walk (FR10, C4). The catalog cursor
// carries the opaque cursor token and its page index; the pagination guard carries the
// max-page bound and the last-seen cursor so a repeated or non-advancing cursor terminates
// the walk and a max-page breach fails closed with a typed error rather than looping (FR10,
// C4). A catalog page carries the bounded tool-name list and the next cursor. Page bounds
// are provisional plan constants (C4). No shape inlines tool content.

package mcp.tools

import (
	"mcp/ids"
	"mcp/values"
)

// CatalogCursor carries the opaque tools/list cursor token and its page index (FR10, C4).
#CatalogCursor: {
	cursor:     ids.#Cursor | null
	page_index: values.#PageIndex
}

// PaginationGuard carries the max-page bound and last-seen cursor; duplicate cursor terminates (FR10, C4).
#PaginationGuard: {
	max_pages:   values.#MaxPages
	page_size:   values.#PageSize
	seen_cursor: ids.#Cursor | null
}

// CatalogPage carries the bounded tool-name list and the next cursor of one walk step (FR10, C4).
#CatalogPage: {
	tools:       ids.#ToolNameList
	next_cursor: ids.#Cursor | null
	page_index:  values.#PageIndex
}
