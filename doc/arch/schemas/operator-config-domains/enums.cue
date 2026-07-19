// DDD role: ValueObject
// Package: operator_config_domains.enums
// Bounded enums for the Feature 013 wiring of the four remaining config-backed
// operator domains — telemetry, smart, budget, pools — onto real typed domain
// ports over the SAME Config.Service authority the langlock/jobs domains use.
// They name the domain, the per-domain verbs, the typed mutation outcome, the
// telemetry-probe outcome, the OTLP transport, and whether a verb persists today.
// Feature 007 stays the sole command-registration authority; no id is added and
// no catalog version is bumped (FR11).

package operator_config_domains.enums

// ConfigDomain is the closed set of four config-backed domains this feature wires from stub to live (FR1).
#ConfigDomain: "telemetry" | "smart" | "budget" | "pools"

// TelemetryVerb is the reserved telemetry.* verb surface backed by the effective telemetry config (FR2, FR6).
#TelemetryVerb: "status" | "show" | "on" | "off" | "configure" | "test"

// SmartVerb is the reserved smart.* verb surface projecting the routing Activation.enabled state (FR3).
#SmartVerb: "status" | "on" | "off" | "auto"

// BudgetVerb is the reserved budget.* verb surface backed by the RoutingConfig Enforcement budget (FR4).
#BudgetVerb: "status" | "show" | "set" | "reset" | "validate"

// PoolsVerb is the reserved pools.* verb surface projecting the RoutingConfig Models role_pools map (FR5).
#PoolsVerb: "status" | "show" | "set" | "reset" | "validate"

// MutationOutcome is the typed envelope a mutation degrades to; never a fabricated success (FR7, FR8).
#MutationOutcome: "success" | "version_conflict" | "invalid_argument" | "unauthorized" | "unavailable"

// ProbeOutcome is the typed result of the telemetry.test OTLP reachability probe; test-signal only (FR6, FR10).
#ProbeOutcome: "reachable" | "unreachable" | "misconfigured"

// Transport is the OTLP export transport the telemetry probe dials: HTTP protobuf POST or gRPC TCP (FR6).
#Transport: "http/protobuf" | "grpc"

// PersistenceClass records that a wired verb persists today, flipping the four domains off honest_unavailable (FR9).
#PersistenceClass: "persists_today" | "honest_unavailable"
