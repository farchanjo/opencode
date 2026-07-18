// DDD role: ValueObject
// Package: outputspool.admin
// Export/share admin request shapes and the migration flag (FR44, C16, C17). Share
// and export are deny-by-default across projects; an in-project export requires an
// operator principal, project scope and a bounded content encoding, never a raw
// path (FR44, Privacy 3, C17). Migration is phased behind a feature flag with a
// bounded dual-read window over the legacy BackgroundJob/ToolOutputStore surfaces
// (FR31, C16). Numeric window/cap defaults are plan constants with hooks AC12/AC13.

package outputspool.admin

import (
	"outputspool/ids"
	"outputspool/enums"
)

// Enabled flags whether the phased migration seam is active (FR31, C16).
#Enabled: bool

// DualRead flags whether the legacy string surface is read alongside the OutputRef (FR31, C16).
#DualRead: bool

// MigrationState is the C16 feature-flag state over the legacy dual-read window (FR31, C16, AC12).
#MigrationState: {
	enabled:   #Enabled
	dual_read: #DualRead
}

// ExportRequest is a deny-by-default in-project export; bounded encoding, never a raw path (FR44, C17, AC13).
#ExportRequest: {
	output_ref: ids.#OutputRef
	scope:      enums.#ActionScope
	encoding:   enums.#ExportEncoding
	principal:  ids.#Principal
}

// ShareRequest is a deny-by-default in-project share; re-evaluated per action (FR44, C17, AC15).
#ShareRequest: {
	output_ref: ids.#OutputRef
	scope:      enums.#ActionScope
	principal:  ids.#Principal
}
