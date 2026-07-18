---
status: accepted
date: 2026-07-18
deciders: [project maintainers]
---

# 0001 — OpenTelemetry telemetry foundation and bounded OTLP export

## Context and Problem Statement

Feature 001 requires local-first observability for Smart Agent Routing and its
execution lifecycle. Telemetry must be useful for routing evidence without
blocking prompts or routing, exposing sensitive content, coupling the product to
a visualization vendor, or making unsupported delivery guarantees across
backends. The feature also requires persistent global/project Settings and
operator-only telemetry commands.

## Decision Drivers

- Preserve prompt and routing availability when telemetry transport degrades.
- Keep instrumentation, transport, and destinations backend-agnostic.
- Make routing evidence correlated, bounded, private, and useful offline.
- Keep telemetry management operator-only and consistent across native surfaces.

## Decision Outcome

Chosen option: **OpenTelemetry with OTLP and bounded asynchronous export**.

We choose **OpenTelemetry for instrumentation and OTLP for transport** as the
telemetry foundation.

- Settings opened through Ctrl+P own persistent global/project configuration,
  validated precedence, signal selection, privacy/redaction, and secure secret
  references. Secrets are not stored in plaintext JSON or command input.
- Export is asynchronous and bounded. Queue, batch, timeout, retry, shutdown,
  backpressure, and delivery semantics remain configured and observable; export
  never blocks the prompt or routing hot path.
- A local metrics store/cache is used on the router hot path. Remote telemetry
  backends are not queried per Task. The design is backend-agnostic and is
  compatible with Alloy and an OpenTelemetry Collector when the selected signal
  exporter supports them.
- Metrics, structured logs, and traces/spans are supported. Profiling is an
  optional runtime/exporter capability and is explicitly reported when absent.
- Correlation follows session → turn → routing → decision model → executor →
  tools → fallback, including manager/brain negotiation and validation outcomes.
- Cardinality is controlled with bounded enums/buckets and allowlisted active
  catalog identifiers under a configurable budget. Sensitive content, prompts,
  secrets, personal paths, complete files, and tool payloads are redacted or
  excluded by default. Grafana is not a required UI or signal store.
- Telemetry management uses the Feature 007 unified Operator Control Plane and
  native operator-only palette, slash, CLI, and Settings adapters calling typed
  core domain commands/queries directly. These operations are not LLM interfaces,
  tools, MCP calls, or transcript content. MUST NOT use Config.command/custom
  templates, `session.command`, ToolRegistry, plugins, skills, or free-form model
  instructions as management authority. Native slash is intercepted before prompt
  admission; zero provider/model calls/tokens/cost by default; output not added to
  Message/Part/context by default. Mutations require operator principal, explicit
  scope, version/CAS, idempotency, and audit; secret refs only.

### Consequences

#### Positive

- Routing can use local evidence offline without a remote backend in its hot path.
- Session-to-fallback investigations share stable correlation and privacy rules.
- Export failure is isolated from prompt and Task execution.
- Backend and visualization choices remain replaceable.

#### Trade-offs and open questions

- Queue limits, sampling, retention, local storage, bootstrap, authentication,
  TLS defaults, and exact delivery semantics remain open in Feature 001.
- Provider/exporter support differs by signal; profiling cannot be assumed to use
  OTLP universally.
- The implementation must establish bounded dimensions and redaction before
  enabling detailed routing analysis.

## Considered Options

- **OpenTelemetry with OTLP** — selected for standard instrumentation and an
  exporter/backend-neutral transport contract.
- **Backend-specific instrumentation and export** — rejected because it couples
  routing behavior to a vendor and complicates offline/local operation.
- **Telemetry only in plugins or a remote backend** — rejected because plugin
  hooks do not cover the complete Task lifecycle and remote queries are forbidden
  on the routing hot path.

## Related

- Feature specification: [001 Smart Agent Routing and Telemetry Foundation](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- This ADR is the **telemetry foundation** and does **not** depend on ADR-0002. Consumers
  of telemetry (including [0002 — Core Smart Agent Routing](0002-core-smart-agent-routing.md))
  depend on or relate to this foundation; they do not invert the dependency.
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md) — proposed sole management authority for telemetry configure/status/test and all operator admin surfaces.
- Research evidence: [Plugin systems research note](../research/plugin-systems.md)
- Related feature: [002 Task Lifecycle Event Bus and Process Table](../sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- Related feature: [003 Scheduled Jobs and Async Main-Context Notification](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- Related feature: [005 OutputSpool and ArtifactStore](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) — content-plane metrics only; no content/path/ref labels
- Related feature: [006 Semantic Agent and Skill Retrieval (Milvus)](../sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — semantic latency/candidates/fallback metrics only; no query text/vectors/entity IDs as labels
- Related feature: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — management foundation; not runtime execution authority
- Related feature: [008 Complete MCP Client Tools and Resources Lifecycle](../sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — MCP connect/call/progress/read/subscribe spans and metrics; no URI/content/call/session IDs as labels
