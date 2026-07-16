---
status: proposed
date: 2026-07-16
deciders: [project maintainers]
---

# 0002 — Core Smart Agent Routing with telemetry dependency

## Context and Problem Statement

Feature 001 requires Smart Agent Routing to cover the native Task lifecycle,
manager-only brain behavior, deterministic authorization, tool capability gates,
safe fallback, and operator-only management commands. Plugin research records
that public hooks do not guarantee dynamic model selection, complete Task
lifecycle coverage, or transactional fallback. Routing also needs the local
telemetry foundation defined by ADR-0001.

## Decision Drivers

- Cover the complete native Task lifecycle and preserve canonical permissions.
- Keep hard-gate authority independent from consultative model recommendations.
- Avoid duplicate catalogs, runtimes, registries, lifecycle loops, and retry owners.
- Make manager mode, tool capabilities, fallback, and operator controls auditable.

## Decision Outcome

Chosen option: **Core Smart Agent Routing with telemetry dependency**.

We choose **Smart Agent Routing in the OpenCode core, dependent on the telemetry
foundation in ADR-0001**, and not a plugin implementation.

- Candidate discovery and resolution reuse the canonical Catalog/ModelsDev,
  SessionRunnerModel, AgentV2, SkillV2, Permission/Policy, configuration,
  EventV2, Session, SessionRunner, and Task lifecycle authorities.
- Deterministic hard gates are authoritative. A decision model is consultative
  and may recommend only among authorized candidates. Final ranking and tie-break
  behavior is deterministic and auditable.
- Smart brain mode is manager-only when active: the primary context plans,
  decomposes, negotiates constraints, dispatches specialists, validates results,
  and reports. It does not directly execute project work under that policy.
- The TUI shows contextual `Smart` in red when brain mode and routing are
  effectively active, without renaming the underlying `build` agent.
- Tool capabilities are dimensioned independently: tool calling presence,
  calls-per-provider-turn limit, same-turn multiple-call emission, serial runner
  execution, actual parallel calls, continuation after tool results, and
  multi-turn tool-use cycles. Serialization does not create a missing model
  capability.
- Fallback is authorized by hard gates and classified by mutation boundary. A
  mutating effect is never blindly repeated.
- Smart and routing management commands are native operator-only palette, slash,
  CLI, and Settings operations. They are not exposed through ToolRegistry,
  model tools, MCP, prompts, or transcripts.
- Routing uses ADR-0001's local metrics/events and correlated telemetry. OTLP
  export remains asynchronous and never blocks the routing hot path.

### Consequences

#### Positive

- Core routing covers native Task paths that plugin hooks cannot guarantee.
- Existing permissions, lifecycle, schemas, catalogs, and event identities remain
  the single source of authority.
- Hard gates prevent a model recommendation from bypassing authorization.
- Local telemetry can make decisions offline while exporting asynchronously.

#### Trade-offs and open questions

- Core integration requires explicit seams and an ADR-backed implementation plan.
- Routing score weights, decision-model mode defaults, pins, initial profiles,
  tool capability schema/precedence, UI details, fallback after partial effects,
  and V1/V2 boundaries remain open in Feature 001.
- ADR-0001 must be accepted or otherwise resolved before routing implementation
  relies on its telemetry contract.

## Considered Options

- **Core Smart Agent Routing** — selected because native lifecycle, permission,
  catalog, model, and fallback coverage are required.
- **Plugin-only routing** — rejected because public hooks do not guarantee full
  Task lifecycle, dynamic model selection, or transactional fallback.
- **`smart_task` replacement** — rejected because it would not preserve native
  Task semantics and would create a parallel lifecycle seam.
- **Minimal core seam with plugin policy** — retained as research context only;
  it is not the approved placement for this feature.

## Related

- Feature specification: [001 Smart Agent Routing and Telemetry Foundation](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- Depends on: [0001 — OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)
- Research evidence: [Plugin systems research note](../research/plugin-systems.md)
- Related feature: [002 Task Lifecycle Event Bus and Process Table](../sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- Related feature: [003 Scheduled Jobs and Async Main-Context Notification](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
