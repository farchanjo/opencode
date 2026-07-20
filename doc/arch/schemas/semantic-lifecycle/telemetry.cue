// DDD role: ValueObject
// Package: semantic_lifecycle.telemetry
// The real OTLP telemetry export activation (Feature 019, Group D). Today the routing
// OTLP sink is built once from effective config with NO network transport wired
// (createOtlpAdapter without a transport → createUnavailableTransport, permanently
// offline), so telemetry.on flips config but no signal is ever sent. The bounded
// export queue (BoundedExportQueue: capacity/batch/drop) already exists; a real
// transport, retry-budget enforcement, and an eager pipeline do not. Feature 019
// composes a process-singleton, fail-open export pipeline that binds a real transport
// when the effective config enables telemetry, honors the queue/drop/redaction
// contract, and re-resolves on a config change (pull-based — no push invalidation seam
// exists today). Disabled runs no fiber and no network. Redaction defaults exclude
// prompts/secrets/file paths/file content/tool payloads (defensive posture, Security).
// CUE packages are not cross-resolved by the structural reader.

package semantic_lifecycle.telemetry

import (
	"semantic-lifecycle/enums"
	"semantic-lifecycle/shared"
	"semantic-lifecycle/flags"
)

// TelemetrySignalSet is the first-class collection of enabled OTLP signals the pipeline exports; empty when telemetry is disabled (Group D).
#TelemetrySignalSet: [...enums.#TelemetrySignal]

// TelemetryRedaction is the defensive redaction contract enforced on every exported signal; each flag defaults true so no prompt, secret, path, file content, or tool payload leaves the process (Group D, Security).
#TelemetryRedaction: {
	prompts:      flags.#RedactionEnabled
	secrets:      flags.#RedactionEnabled
	filePaths:    flags.#RedactionEnabled
	fileContent:  flags.#RedactionEnabled
	toolPayloads: flags.#RedactionEnabled
}

// ExportQueueBound is the bounded-queue contract the pipeline honors so a slow/unreachable collector never blocks the session loop; overflow applies the drop policy, never backs up the hot path (Group D).
#ExportQueueBound: {
	capacity:        int & >0
	batchSize:       int & >0
	enqueueTimeoutMs: int & >0
	exportTimeoutMs: int & >0
	retryBudget:     int & >=0
	dropPolicy:      enums.#DropPolicy
}

// TelemetryExportPipeline is the eager, fail-open process-singleton export pipeline; armed binds a real transport to the configured endpoint, disabled runs no fiber, a fail-open error never affects the session loop (Group D).
#TelemetryExportPipeline: {
	state:     enums.#TelemetryPipelineState
	transport: enums.#TelemetryTransport
	endpoint:  shared.#EndpointAddress
	signals:   #TelemetrySignalSet
	queue:     #ExportQueueBound
	redaction: #TelemetryRedaction
	reason?:   shared.#ReasonText
}
