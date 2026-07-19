// DDD role: ValueObject
// Package: mcp.content
// The bounded content-plane ValueObjects delivered from every tools/call and
// resources/read (FR33, FR34, C16). UI and LLM receive a bounded preview plus an OutputRef
// only — never a filesystem path — and base64/data-URL content is decoded to a Feature 005
// spool under the MIME allowlist and size caps (FR34, FR36, C16, C17). A resource_link
// stays lazy and is auto-fetched only under policy/Permission/budget (FR26, C11). The URI
// and MIME allowlists gate the fetch and decode. Because the SDK parses the final result in
// RAM the spill is post-parse; zero-RAM is never promised (FR35, C16).

package mcp.content

import (
	"mcp/ids"
	"mcp/enums"
	"mcp/values"
)

// BoundedPreview is the byte-capped redacted head slice delivered beside the OutputRef (FR34, C16).
#BoundedPreview: {
	content_kind: enums.#ContentKind
	mime_type:    ids.#MimeType | null
	byte_cap:     values.#ByteLength
	head:         ids.#RedactedText
	secrets:      ids.#SecretRefList
}

// ContentItem is one spooled content item reached through its OutputRef; never a path (FR34, C16).
#ContentItem: {
	kind:        enums.#ContentKind
	mime_type:   ids.#MimeType | null
	output_ref:  ids.#OutputRef
	byte_length: values.#ByteLength
}

// ResourceLink is a lazy resource reference auto-fetched only under policy/Permission/budget (FR26, C11).
#ResourceLink: {
	resource_uri: ids.#ResourceUri
	mime_type:    ids.#MimeType | null
	title:        ids.#Title
}

// ContentItemList is the first-class collection of spooled content items (FR34, C16).
#ContentItemList: [...#ContentItem]

// ContentEnvelope is the bounded delivered envelope: items, preview, OutputRef, provenance (FR34, C16, C24).
#ContentEnvelope: {
	items:      #ContentItemList
	preview:    #BoundedPreview
	output_ref: ids.#OutputRef
	provenance: enums.#ProvenanceClass
}

// McpCallOutput is the OutputGroup descriptor of one tools/call; preview plus OutputRef only (FR33, C16).
#McpCallOutput: {
	group_id:    ids.#GroupId
	request_id:  ids.#RequestId
	outcome:     enums.#CallOutcome
	preview:     #BoundedPreview
	output_ref:  ids.#OutputRef
	byte_length: values.#ByteLength
}

// McpReadOutput is the OutputGroup descriptor of one resources/read; preview plus OutputRef only (FR33, C16).
#McpReadOutput: {
	group_id:    ids.#GroupId
	resource_uri: ids.#ResourceUri
	mime_type:   ids.#MimeType | null
	preview:     #BoundedPreview
	output_ref:  ids.#OutputRef
	byte_length: values.#ByteLength
}

// UriAllowlist is the resource URI allowlist: https plus roots-scoped URIs, file within roots (FR25, C12).
#UriAllowlist: {
	schemes:             ids.#SchemeSet
	roots:               ids.#RootUriList
	allow_file_in_roots: ids.#Enabled
}

// MimeAllowlist is the MIME allowlist and byte cap gating decode-to-spool (FR36, C17).
#MimeAllowlist: {
	types:     ids.#MimeTypeSet
	max_bytes: values.#ByteLength
}
