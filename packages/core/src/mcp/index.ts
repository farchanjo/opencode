/**
 * Feature 008 — MCP domain lifecycle engine barrel (T023).
 *
 * Re-exports every framework-free `packages/core/src/mcp/*` domain module under its
 * own namespace, one line per module, mirroring `packages/core/src/semantic/index.ts`,
 * `packages/core/src/langlock/index.ts`, `packages/core/src/lifecycle/index.ts`, and
 * `packages/core/src/jobs/index.ts`, and each module's own `export * as X from "./x"`
 * self-export. This file defines no domain logic of its own.
 *
 * The domain engine is pure and deterministic over injected transport / clock /
 * entropy / config / permission / spool / event ports (C2): the connection-lifecycle
 * state machine with negotiation/record and additive terminal branches, the
 * reconnect-backoff planner (bounded exponential + jitter + cap, resume /
 * `Last-Event-ID`, stdio restart), the tool-catalog paginated-walk policy with the
 * duplicate-cursor guard and max-page fail-closed, the resource-update
 * coalesce/dedupe/debounce policy, the resource-subscription machine, the
 * cancellation wire-path selector, the typed capability-gap classifier, the
 * trust/validation/provenance/size gate, and the content-free telemetry instruments.
 * The SDK client, the Streamable-HTTP/SSE/stdio transports, OAuth, the Feature 005
 * OutputSpool, and the durable-event projection live in the
 * `packages/opencode/src/mcp/**` application layer.
 */

export * as CancelSelector from "./cancel-selector"
export * as CatalogPolicy from "./catalog-policy"
export * as ConnectionLifecycle from "./connection-lifecycle"
export * as Degradation from "./degradation"
export * as McpInstruments from "./mcp-instruments"
export * as ReconnectPlanner from "./reconnect-planner"
export * as ResourcePolicy from "./resource-policy"
export * as SubscriptionMachine from "./subscription-machine"
export * as TrustGate from "./trust-gate"
