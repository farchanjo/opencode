// DDD role: ValueObject
// Package: lifecycle.shared
// Correlation and model-descriptor ValueObjects. The routing-parity ids
// (DecisionId, TurnId, ModelId, ProviderName, VariantName) mirror
// routing.shared by name; they are re-declared here, not cross-imported.

package lifecycle.shared

// CorrelationId groups related events across a logical operation.
#CorrelationId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// CausationId references the event that directly caused this one.
#CausationId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// DecisionId references a Feature 001 routing.decision — parity id.
#DecisionId: string & =~"^[0-9A-HJKMNP-TV-Z]{26}$"

// TurnId references a single turn within a Session — parity id.
#TurnId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// AgentName is the canonical specialist-agent name for a process.
#AgentName: string & !~"^$"

// ModelId is a canonical model identifier — parity id.
#ModelId: string & !~"^$"

// ProviderName names a model provider — parity id.
#ProviderName: string & !~"^$"

// VariantName names a provider/model variant — parity id.
#VariantName: string & !~"^$"

// TodoRef references a Session-owned Todo aggregate observed by the row.
#TodoRef: string & !~"^$"

// TodoVersion pins an opaque monotonic Todo revision token.
#TodoVersion: string & !~"^$"
