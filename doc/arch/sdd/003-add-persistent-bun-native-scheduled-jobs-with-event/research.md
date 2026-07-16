# Scheduled Jobs and Async Main-Context Notification Research

Feature: [003 Scheduled Jobs and Async Main-Context Notification](spec.md)

This note records read-only facts and source references. It separates evidence from
requirements and decisions; it is not an ADR and does not authorize implementation.

## Toolchain and official Bun evidence

- The repository declares `bun@1.3.14` in [`package.json:7`](../../../../package.json#L7).
  The local runtime reports Bun `1.3.14`.
- Official Bun Cron documentation: [Bun Cron](https://bun.com/docs/runtime/cron),
  retrieved 2026-07-16, documents `Bun.cron(schedule, handler)`, cron parsing,
  `CronJob.stop/ref/unref`, `Bun.cron.remove`, OS-level registration, no-overlap
  handler semantics, and fake-timer support.
- The same official documentation states that in-process cron does **not** survive
  process exit/reboot, while OS-level registration does. Therefore this feature must
  persist definitions and rehydrate registrations; a Bun registration is not durable
  authority by itself.
- The official no-overlap guarantee applies to the in-process
  `Bun.cron(schedule, handler)` form: the next fire waits for the handler's returned
  Promise to settle. OS-level `Bun.cron(path, schedule, title)` launches a separate
  script/process on the platform scheduler; it does not share the OpenCode Session,
  Effect services, database pools, or in-memory runtime with the parent process.
  Returning OS-level execution to the core therefore requires an explicit bootstrap
  and IPC/API seam, which remains a feature question.
- The official API supports a 5-field cron grammar, UTC interpretation for parsing and
  in-process scheduling, and system-local timezone behavior for OS-level scheduling.
  DST/minimum interval/platform policy remain feature questions rather than assumed
  defaults.
- A separate official timers page was not available at
  `https://bun.com/docs/runtime/timers` on 2026-07-16 (HTTP 404). No timer API claim
  is derived from that URL.

## Current-core evidence

- TaskTool uses `BackgroundJob.Service`, Session, config, scope, and prompt execution
  at [`packages/opencode/src/tool/task.ts:81-92`](../../../../packages/opencode/src/tool/task.ts#L81-L92).
- Task child Session creation and parent linkage are at
  [`packages/opencode/src/tool/task.ts:136-172`](../../../../packages/opencode/src/tool/task.ts#L136-L172).
- BackgroundJob active state, fork, start, and cancel are process-local service
  behavior at [`packages/core/src/background-job.ts:173-251`](../../../../packages/core/src/background-job.ts#L173-L251)
  and [`packages/core/src/background-job.ts:337-349`](../../../../packages/core/src/background-job.ts#L337-L349).
- SessionInput admission vocabulary and wake/queue/steer boundaries are defined in
  [`AGENTS.md` V2 Session Core guidance](../../../../AGENTS.md) and the current session
  implementation at [`packages/opencode/src/session/session.ts:491-499`](../../../../packages/opencode/src/session/session.ts#L491-L499).
  Exact feature integration remains open and must use canonical APIs.
- SessionRunCoordinator serializes a key, coalesces wakeups, and interrupts the
  active owner at [`packages/core/src/session/run-coordinator.ts:5-15`](../../../../packages/core/src/session/run-coordinator.ts#L5-L15)
  and [`packages/core/src/session/run-coordinator.ts:67-103`](../../../../packages/core/src/session/run-coordinator.ts#L67-L103).
- EventV2 provides durable aggregate reads and live streams at
  [`packages/core/src/event.ts:63-108`](../../../../packages/core/src/event.ts#L63-L108).
  Bounded subscriber delivery and overflow are implemented by `allBounded` at
  [`packages/core/src/event.ts:152-164`](../../../../packages/core/src/event.ts#L152-L164),
  while the global PubSub is unbounded at
  [`packages/core/src/event.ts:170-180`](../../../../packages/core/src/event.ts#L170-L180).
- Native event subscription uses EventV2 and a subscriber capacity in
  [`packages/server/src/handlers/event.ts:20-39`](../../../../packages/server/src/handlers/event.ts#L20-L39).
- Native command registry/CLI composition is visible in
  [`packages/cli/src/index.ts:6-27`](../../../../packages/cli/src/index.ts#L6-L27) and
  prompt command/template handling is distinct in
  [`packages/opencode/src/session/prompt.ts:1356-1390`](../../../../packages/opencode/src/session/prompt.ts#L1356-L1390).
- OTel support is partial: endpoint/header flags are at
  [`packages/core/src/flag/flag.ts:16-17`](../../../../packages/core/src/flag/flag.ts#L16-L17),
  and trace OTLP setup is at [`packages/core/src/observability/otlp.ts:7-71`](../../../../packages/core/src/observability/otlp.ts#L7-L71).

## Evidence boundaries

- Current-core facts may change and do not decide the final scheduler adapter,
  persistence schema, admission ownership, notification policy, or distributed model.
- Feature 003 must reuse Feature 002 lifecycle/event seams and Feature 001 routing;
  this research note does not authorize a second executor, event bus, or scheduler
  authority.
- The official Bun capability is a runtime adapter capability. Persistence,
  rehydration, misfire handling, ownership, and notification delivery remain feature
  requirements and open questions.

## Related evidence

- [Feature 001 specification](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- [Feature 002 specification](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- [ADR-0001 — OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 — Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
