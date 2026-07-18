// DDD role: ValueObject
// Package: langlock.allowlist
// The initial Lang Lock allowlist — eight canonical BCP 47 tags with their human
// and native display names (FR3, FR4, C13). Tags are validated by
// Intl.getCanonicalLocales plus this allowlist; the technical tag is never the
// primary picker label (FR4, AC3). English (United States) is enabled by default (FR1).

package langlock.allowlist

import "langlock/ids"

// AllowlistEntry pairs a canonical tag with its human and native display names (FR3, C13).
#AllowlistEntry: {
	tag:          ids.#LanguageTag
	display_name: ids.#DisplayName
	native_name:  ids.#DisplayName
}

// Allowlist is the first-class collection of the eight initial allowlisted entries (FR3).
#Allowlist: [...#AllowlistEntry]

// DefaultTag is the enabled-by-default artifact language, English (United States) (FR1).
#DefaultTag: ids.#LanguageTag & "en-US"
