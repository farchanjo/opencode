// DDD role: ValueObject
// Package: telemetry.config
// TelemetryConfig — OpenTelemetry configuration for Feature 001 Phase 1.
// Secrets stored via Feature 007 SecretPort (OS keychain), never plaintext.

package telemetry.config

// SecretRef is an opaque reference resolved via Feature 007 SecretPort.
// Never store the actual secret value.
#SecretRef: string

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

		// Exclude tool call payloads from all signals.
		tool_payloads: bool
	}

	// OpenTelemetry resource attributes attached to every signal.
	resource_attributes: { [ADDRESS]: string }

	// Sampling ratio: 0.0 = no signals, 1.0 = everything.
	// Constrained to [0.0, 1.0] — no bare float.
	sampling: float & >=0.0 & <=1.0
}