// DDD role: ValueObject
// Package: telemetry.config
// TelemetryConfig — OpenTelemetry configuration for Feature 001 Phase 1.
// Secrets stored via Feature 007 SecretPort (OS keychain), never plaintext.

package telemetry.config

// SecretRef is an opaque reference resolved via Feature 007 SecretPort.
// Never store the actual secret value.
//
// Canonical opaque encoding (parsed only by the SecretPort adapter, never by
// telemetry): "backend:name" or "backend:name@vN", where backend is a
// SecretPort backend id, name is the secret name, and the optional "@vN" pins
// an integer version >= 1. Examples: "keychain:otlp-token",
// "env-ref:OTLP_HEADER@v3". The empty string denotes "no reference configured"
// (e.g. an unset TLS cert while TLS is disabled).
#SecretRef: string & =~"^(|[A-Za-z0-9._-]+:[^@]+(@v[1-9][0-9]*)?)$"

// CardinalityBudget bounds the distinct values admitted per dynamic metric
// label dimension before collapsing to "other" (uint, > 0).
#CardinalityBudget: uint & >0

// SignalShaping groups the volume/precision knobs that shape exported signal
// data: the sampling ratio and the dynamic-label cardinality budget.
#SignalShaping: {
	// Sampling ratio: 0.0 = no signals, 1.0 = everything.
	// Constrained to [0.0, 1.0] — no bare float.
	sampling: float & >=0.0 & <=1.0

	// Per-dimension distinct-value budget for dynamic metric labels.
	cardinality_budget: #CardinalityBudget
}

// Transport protocol for OTLP export.
#Transport: "http/protobuf" | "grpc"

// Drop policy when bounded queue is full.
#DropPolicy: "drop" | "backpressure"

// Signal kinds that can be independently enabled/disabled.
#SignalKind: "metrics" | "logs" | "traces" | "profiling"

// EnabledFlag — explicit on/off toggle (DDD role: ValueObject).
#EnabledFlag: bool

// EndpointUrl — OTLP-compatible endpoint URL (DDD role: ValueObject).
#EndpointUrl: string & =~"^https?://"

// ExportTarget — where and how signals are exported (DDD role: ValueObject).
#ExportTarget: {
	// OTLP-compatible endpoint URL (e.g. http://localhost:4318).
	endpoint: #EndpointUrl

	// Transport protocol for OTLP.
	transport: #Transport

	// Custom headers carrying auth material — values are SecretRef only.
	headers: { [ADDRESS]: #SecretRef }

	// TLS settings for the export connection.
	tls: {
		enabled: #EnabledFlag
		// Certificate reference resolved via Feature 007 SecretPort.
		cert: #SecretRef
	}
}

#TelemetryConfig: {
	// Whether telemetry collection is actively exporting.
	enabled: #EnabledFlag

	// Export destination, transport, auth headers, and TLS settings.
	export: #ExportTarget

	// Per-signal enablement flags.
	signals: {
		metrics:     bool
		logs:        bool
		traces:      bool
		profiling:   bool
	}

	// Bounded async export queue settings.
	queue: {
		// Maximum number of signals held in the queue before apply drop/backpressure.
		capacity: uint & >0

		// Number of signals batched per export attempt.
		batch_size: uint & >0

		// Milliseconds to wait for enqueue before applying drop/backpressure.
		enqueue_timeout_ms: uint & >0

		// Milliseconds before an individual export attempt times out.
		export_timeout_ms: uint & >0

		// Maximum retry attempts after transient export failures.
		retry_budget: uint

		// Policy applied when queue reaches capacity.
		drop_policy: #DropPolicy
	}

	// Privacy redaction flags — content excluded from metric labels and log bodies.
	redact: {
		// Exclude prompt content from all signal exports.
		prompts: bool

		// Exclude secret values (tokens, keys, credentials) from all signals.
		secrets: bool

		// Exclude file system paths from all signals.
		file_paths: bool

		// Exclude file content (bodies, diffs, snippets) from all signals.
		file_content: bool

		// Exclude tool call payloads from all signals.
		tool_payloads: bool
	}

	// OpenTelemetry resource attributes attached to every signal.
	resource_attributes: { [ADDRESS]: string }

	// Sampling ratio and dynamic-label cardinality budget.
	shaping: #SignalShaping
}