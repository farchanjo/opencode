// DDD role: ValueObject
// Package: routing.shared
// Shared identifier ValueObjects reused across the routing schema.
// Centralised here to avoid primitive obsession and duplicated constraints.

package routing.shared

// SessionId identifies a Session across the telemetry correlation chain.
#SessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// TurnId identifies a single turn within a Session.
#TurnId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// DecisionId is the ULID of a routing decision — sort order encodes creation time.
#DecisionId: string & =~"^[0-9A-HJKMNP-TV-Z]{26}$"

// ExecutionId identifies a task-execution span at full correlation depth.
#ExecutionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// AgentId is a canonical specialist-agent identifier.
#AgentId: string & !~"^$"

// ModelId is a canonical model identifier resolved from ModelsDev.
#ModelId: string & !~"^$"

// SkillName names a single skill selected for a candidate.
#SkillName: string & !~"^$"

// ProviderName names a model provider.
#ProviderName: string & !~"^$"

// VariantName names a provider/model variant.
#VariantName: string & !~"^$"

// ApiFamily is a normalised API family (e.g. "openai" | "anthropic").
#ApiFamily: string & !~"^$"
