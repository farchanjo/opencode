# Task Lifecycle Event Bus and Process Table Research

Feature: [002 Task Lifecycle Event Bus and Process Table](spec.md)

This note records current-core evidence separately from requirements and decisions.
It is not an ADR and does not authorize implementation. Requirements live in
`spec.md`; architectural decisions are reserved for a future ADR named there.

## Confirmed core facts

- Bun is the priority runtime. Effect fibers are the lightweight unit for concurrent
  asynchronous work. The current TaskTool enters the Effect runtime and BackgroundJob
  service at [`packages/opencode/src/tool/task.ts:81-92`](../../../../packages/opencode/src/tool/task.ts#L81-L92).
- Task V1 creates or reuses a child Session and uses process-local BackgroundJob;
  child-session creation and parent linkage are visible at
  [`packages/opencode/src/tool/task.ts:136-172`](../../../../packages/opencode/src/tool/task.ts#L136-L172).
  BackgroundJob stores active jobs in an in-memory state map and forks work into a
  scope at [`packages/core/src/background-job.ts:173-188`](../../../../packages/core/src/background-job.ts#L173-L188)
  and [`packages/core/src/background-job.ts:202-251`](../../../../packages/core/src/background-job.ts#L202-L251).
  V2 has SessionExecution, SessionRunCoordinator, and SessionRunner; there is no
  independent TaskV2 runtime in the observed lifecycle code.
- Session, parentID, and messages are durable. BackgroundJob and active executions
  are in memory; restart loses their process-local registry.
- SessionRunCoordinator serializes work per Session, permits distinct Sessions to run
  concurrently, and coalesces wakes; its active-key map, wake coalescing, and
  per-key drain are shown at
  [`packages/core/src/session/run-coordinator.ts:5-15`](../../../../packages/core/src/session/run-coordinator.ts#L5-L15)
  and [`packages/core/src/session/run-coordinator.ts:67-103`](../../../../packages/core/src/session/run-coordinator.ts#L67-L103).
- No global scheduler, `maxTasks`, `maxAgents`, or central admission authority was
  found in the current core search. The observed coordinator exposes only a per-key
  active set, run, wake, and interrupt contract at
  [`packages/core/src/session/run-coordinator.ts:5-15`](../../../../packages/core/src/session/run-coordinator.ts#L5-L15),
  while BackgroundJob owns a local job map at
  [`packages/core/src/background-job.ts:190-200`](../../../../packages/core/src/background-job.ts#L190-L200).
  This is an evidence boundary, not a requirement or a decision; the admission
  ownership question remains open.
- EventV2 distinguishes durable and live events through its durable aggregate reader
  and stream APIs at [`packages/core/src/event.ts:63-108`](../../../../packages/core/src/event.ts#L63-L108).
  Its global PubSub is unbounded at [`packages/core/src/event.ts:170-180`](../../../../packages/core/src/event.ts#L170-L180),
  while `allBounded` creates a subscriber-local dropping queue at
  [`packages/core/src/event.ts:152-164`](../../../../packages/core/src/event.ts#L152-L164).
  The server event handler currently selects a subscriber capacity at
  [`packages/server/src/handlers/event.ts:9-34`](../../../../packages/server/src/handlers/event.ts#L9-L34).
- SessionEvent is currently a schema re-export at
  [`packages/core/src/session/event.ts:1-2`](../../../../packages/core/src/session/event.ts#L1-L2);
  EventV2 durable/live behavior is therefore the observed event evidence rather than
  a claim that a Task lifecycle bus already exists.
- OpenTelemetry support is partial in the current core: endpoint/header inputs are
  exposed at [`packages/core/src/flag/flag.ts:16-17`](../../../../packages/core/src/flag/flag.ts#L16-L17),
  and the current exporter path focuses on trace OTLP HTTP setup at
  [`packages/core/src/observability/otlp.ts:7-71`](../../../../packages/core/src/observability/otlp.ts#L7-L71).
  Complete Task lifecycle spans, meters, and a Process Table are not established by
  the current core. This research note records the absence as evidence, not as a
  design decision.
- Canonical lifecycle points are TaskTool, BackgroundJob, SessionExecution,
  SessionRunCoordinator, SessionRunner, and EventV2.

## Evidence boundaries

- These observations describe the current core at research time and may become stale
  as implementation changes.
- The proposed lifecycle bus must reuse the canonical points above and must not become
  a second executor, runtime, lifecycle loop, or EventV2 system.
- The Process Table described by Feature 002 is a proposed event projection, not a
  fact that the current core already provides.

## Related evidence

- [Feature 001 specification](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- [ADR-0001 — OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 — Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
- [Plugin systems research](../../research/plugin-systems.md)
