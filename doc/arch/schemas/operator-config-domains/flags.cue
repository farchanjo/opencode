// DDD role: ValueObject
// Package: operator_config_domains.shared
// Bounded boolean ValueObjects for the Feature 013 config-backed domain ports.
// Each operator-surface flag is a named type so no bare bool is carried inline
// (wrap-primitives). They record whether a domain is configured, reachable as a
// live port, enabled, and whether the effective config validated — never a
// fabricated availability (FR7, FR8).

package operator_config_domains.shared

// Configured is true when the domain has a persisted Config.Service entry, false when it is unconfigured (FR1).
#Configured: bool

// Available is true only when the live domain port is reachable; a stub or unreachable config resolves false (FR8).
#Available: bool

// Enabled is the domain's effective on/off state (telemetry export, smart routing) projected from config (FR2, FR3).
#Enabled: bool

// AutoMode is true when smart routing runs in automatic mode via smart.auto, false under an explicit on/off (FR3).
#AutoMode: bool

// Valid is the outcome of budget.validate / pools.validate over the effective config; never asserted blindly (FR4, FR5).
#Valid: bool
