---
id: 019f8516-f3da-7ff0-b7f2-442529b3628c
number: 049
slug: wire-the-hierarchy-dispatch-resolver-into-the-live-task-tool
status: implemented
created_at: 2026-07-21T14:31:41.787036Z
---
# Feature Specification: Wire The Hierarchy Dispatch Resolver Into The Live Task Tool

Feature: 049-wire-the-hierarchy-dispatch-resolver-into-the-live-task-tool
Created: 2026-07-21

## Problem

Features 042 (Architect -> Manager -> Worker hierarchy delegation) and 048
(`force_manager` orchestration mode) are implemented but were never wired into
the LIVE LLM `task`-tool execution path. There are two subagent spawn paths:

1. `handleSubtask` (`session/prompt.ts`) — the mention/slash-command subtask
   path. It DOES consult the resolver: it calls `resolveHierarchyDispatch(...)`
   and injects `hierarchyDispatch` into the task tool's `ctx.extra`.
2. `SessionTools.resolve` -> `TaskTool.execute` — the path a real LLM delegation
   (and @mention) takes. Its `ctx.extra` was built as
   `{ model, bypassAgentCheck, promptOps }`, OMITTING any hierarchy wiring. So
   `TaskTool.execute` read `ctx.extra?.hierarchyDispatch` = undefined, every
   F042/F048 branch was inert (force-manager routing, `denyExecutionTools`,
   Manager persona, completion gate), and the child fell to parent-model
   inheritance.

Empirical proof (deployed binary, `force_manager` configured at both operator
scopes): across 3 live runs the child subagent ALWAYS ran on the parent's model
(worker/worker, terra/terra, sol/sol), never a different tier, and no "hierarchy
tier degraded" warning ever fired — the resolver was never called on this path.

Secondary gap: the command-subtask path stamped `SubtaskPart.model`
UNCONDITIONALLY (`taskModel = currentModel(sessionID)` = the parent model for an
unpinned command), which made `shouldConsultHierarchy(!!task.model, ...)` return
false — so even `handleSubtask` skipped routing for unpinned command-subtasks.

## User Stories

- As an operator who configured `force_manager`, I want an Architect-parent's
  live `task` spawn to route the child to `role_pools.manager`, so the
  three-tier orchestration I configured actually runs.
- As an operator with Smart Routing off (or heuristic mode with no fan-out), I
  want the child to inherit the parent model exactly as today, so nothing
  regresses.
- As a user who pins a model on a `task` call or a child agent, I want that
  model to always win over routing.

## Functional Requirements

1. **FR1 — Per-invocation resolution on the live path.** `SessionTools.resolve`
   builds the tool set ONCE per turn, but the hierarchy decision is PER-SPAWN
   (it depends on the specific `task.prompt`). The resolver plus the per-turn
   parent seeds (parent role, parent delegation depth, main-context model) are
   injected into `ctx.extra` as a closure; `TaskTool.execute` calls it with the
   actual spawn prompt at execution time. Resolution never happens at
   tool-build time.
2. **FR2 — Shared engine, no divergent resolver.** The live seam reuses the SAME
   `resolveHierarchyDispatch` engine, `shouldConsultHierarchy` guard,
   `parentRoleForSpawn` seeding, and route->dispatch mapping the mention path
   uses; the mapping lives in ONE shared helper.
3. **FR3 — Apply the routed model.** The child-model precedence becomes
   `explicit task.model (n/a on LLM path) ?? agent-pinned model ?? routed model
   ?? parent inheritance`.
4. **FR4 — Activate the existing branches.** A routed decision produces the
   `hierarchyDispatch` payload so the existing `TaskTool.execute` branches
   (lineage record, `orchestration_only` tool-gating, depth-ceiling
   reconciliation, Manager persona, completion gate, degraded warning) become
   live.
5. **FR5 — Consult guard.** An explicit `task.model` or a pinned child agent
   short-circuits the resolver; routing never overrides it.
6. **FR6 — Blocked surfaces.** A `{kind:"blocked"}` decision (illegal edge /
   depth exceeded / denied admission) surfaces as a real failed spawn, never a
   silent inheritance.
7. **FR7 — Degraded surfaces.** Under `force_manager`, an engine-admitted tier
   whose pool model fails to resolve is surfaced (a visible warning) then falls
   back to the parent model — never a silent inheritance, never a hard block.
8. **FR8 — Command-subtask fix.** The command-subtask path leaves
   `SubtaskPart.model` UNSET for an unpinned command (no `cmd.model`, no
   agent-pinned model, no explicit `--model`), so `handleSubtask` consults the
   resolver; a genuinely pinned model is still stamped.

## Invariants

- **Default path byte-identical** when Smart Routing is off, OR
  `orchestration_mode` is heuristic and no fan-out warrants a manager: the child
  inherits the parent model exactly as today. When the resolver returns
  undefined/no-route, the seam falls through to the exact current
  parent-inheritance path.
- **Explicit / pinned model always wins** (the `shouldConsultHierarchy`
  short-circuit) — never overridden by routing.
- **Hang/crash-safe** — the resolver call degrades to the ungated
  parent-inheritance spawn on any defect/timeout, never blocks or hangs the
  turn. It composes with the F044 completion gate + `WORKER_MAX_WAIT_MS` and
  F043 budget admission exactly as the mention path does.
- **Workers stay leaves** (`MAX_DELEGATION_DEPTH = 2`); a Manager parent yields
  Worker children; `force_manager` forces a Manager only on the Architect edge.
- **Blocked is not silent** — an illegal edge / depth-exceeded surfaces as a
  blocked spawn.

## Security Requirements

- **Data sensitivity/classification.** This feature moves no new user data. It
  threads a routing decision (a role, a model id, a delegation depth) and a
  session-id lineage stub between the session layer and the task tool. Model ids
  and session ids are non-sensitive control-plane identifiers already present in
  the session record.
- **Authentication/authorization.** No new authenticated surface. The routed
  model is only USED when its provider already has a resolved, authenticated
  credential (the resolver's existing provider re-resolution + auth-presence
  check); an unauthenticated tier degrades to parent inheritance. The
  `orchestration_only` tool-gating (a fail-closed catch-all deny plus a
  read-only allowlist) is APPLIED — not weakened — on a non-Worker child.
- **Input validation.** The only untrusted input is the LLM-emitted
  `task.prompt`, which is passed as-is to the deterministic, zero-LLM analyzer
  (bounded signals) exactly as the mention path already does; it is never
  interpolated into a shell, path, or query.
- **Cryptography in transit/at rest.** Not applicable — this feature persists
  and transmits nothing new; it selects a model for an in-process spawn.
- **Logging/audit.** The degraded-tier warning logs only the child role and a
  typed reason; the blocked-spawn error logs the engine's typed rejection reason
  and detail. No model id secret, credential, or task text is logged.
- **Error-handling information exposure.** A blocked spawn fails with the
  engine's typed reason/detail (a bounded control-plane string), never provider
  internals or secrets; every resolver defect degrades silently to parent
  inheritance.

## Acceptance Scenarios

Given `force_manager` is configured and an Architect parent runs a live `task`
spawn
When the LLM emits the `task` call
Then the child is routed to `role_pools.manager` (not parent inheritance), the
Manager persona is injected, and the dispatch lineage is recorded.

Given Smart Routing is off (or heuristic with no warranted manager)
When the LLM emits a `task` call
Then the child inherits the parent model, byte-identical to today.

Given an explicit `task.model` or a pinned child agent
When the LLM emits a `task` call
Then that model wins and the resolver is not consulted.

Given the hierarchy engine rejects the edge (illegal / depth exceeded / denied
admission)
When the LLM emits a `task` call
Then the spawn fails with the typed rejection, never a silent inheritance.

Given an unpinned command-subtask
When it is dispatched via `handleSubtask`
Then `SubtaskPart.model` is unset and the resolver is consulted.

## Observability

This feature reuses the Feature 047 telemetry already emitted inside the
resolver: a `hierarchy.fanout` span per admission decision (admitted / denied
with a typed reason) and the orchestration-worker terminal metric, both
guarded by the armed-telemetry check so a telemetry-off session allocates
nothing. The new surfaced signals are a `hierarchy tier degraded to parent
model` warning log (child role + typed reason) and the typed blocked-spawn
error. Export telemetry via OTLP from the application boundary; keep metric
label sets bounded (role, admitted, reason enums), and carry the request-scoped
session id on trace spans. Conventions live in
`doc/arch/observability/observability.md`.

## Clarifications
