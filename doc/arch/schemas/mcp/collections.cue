// DDD role: ValueObject
// Package: mcp.shared
// First-class collection ValueObjects replacing bare arrays across profiles, allowlists
// and catalogs (calisthenics). Each wraps a shared ValueObject element so a header-ref
// set, scheme set, root list, MIME set or tool-name set carries one named type rather
// than an anonymous list. A header-ref set holds Feature 007 secure refs, never inline
// secrets (FR32, C15); a root list holds negotiated roots, never arbitrary paths (FR9,
// C12); no element is content.

package mcp.shared

// HeaderRefSet is a first-class collection of secure outbound header refs (FR32, C15).
#HeaderRefSet: [...#HeaderRef]

// SchemeSet is the first-class allowlist of permitted URI schemes; https default (FR25, C12).
#SchemeSet: [...#UriScheme]

// RootUriList is the first-class collection of negotiated project/session roots (FR9, C12).
#RootUriList: [...#RootUri]

// MimeTypeSet is the first-class MIME allowlist gating decode-to-spool (FR36, C17).
#MimeTypeSet: [...#MimeType]

// ToolNameList is the first-class collection of tool names on a catalog page (FR10, C4).
#ToolNameList: [...#ToolName]

// SecretRefList is the first-class collection of SecretRefs redacted out of a preview (FR32, C15).
#SecretRefList: [...#SecretRef]
