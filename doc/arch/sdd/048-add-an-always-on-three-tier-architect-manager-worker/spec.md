---
id: 019f84b7-c046-7bf1-8594-c4e37f2d4026
number: 048
slug: add-an-always-on-three-tier-architect-manager-worker
status: implemented
created_at: 2026-07-21T12:47:42.662809Z
---
# Feature Specification: Add An Always On Three Tier Architect Manager Worker

Feature: 048-add-an-always-on-three-tier-architect-manager-worker
Created: 2026-07-21

## Summary

Today the routing hierarchy is an opportunistic, single-hop heuristic. A Manager
tier appears ONLY when a spawn's task text trips `classifyChildRole`'s fan-out
thresholds (`>= 2` independent work-units across `>= 2` domains, or a requested
parallel fan-out `> 1`); every other Architect task dispatches a direct Worker.
Even when a Manager IS produced, the Manager -> Worker hop is silently blocked by
the legacy `subagent_depth` ceiling collapsing to 1, so the full three-tier flow
never runs. A tier whose pool model fails to resolve silently inherits the
parent (Architect) model, and no persona ever tells a Manager to decompose work
into Workers.

This feature adds an OPT-IN orchestration mode — `hierarchy.orchestration_mode`
with values `heuristic` (default) and `force_manager` — in which EVERY Architect
task flows unconditionally through Architect -> Manager -> Worker(s) -> Manager ->
Architect, each tier on its OWN role pool model. The existing heuristic remains
the DEFAULT and byte-identical; `force_manager` is strictly opt-in and gated on
Smart Routing activation (enabled and mode != `never`). The five wiring defects
that block the always-on flow are fixed ONLY on the `force_manager` path; the
heuristic path is untouched.

## User Stories

- As an operator I want to opt every Architect task into a fixed three-tier
  Architect -> Manager -> Worker orchestration so that decomposition, delegation,
  and aggregation happen on dedicated per-tier models on every task, not only when
  a heuristic trips.
- As an operator I want the default behavior to stay exactly as it ships today so
  that turning the mode off (or leaving it absent) is a guaranteed no-op.
- As an operator I want an explicit `--model` or an agent-pinned model to always
  win in both modes so that the orchestration mode never overrides my choice.
- As an operator I want a tier whose pool model cannot resolve to surface a
  visible warning rather than silently running on the Architect's model so that I
  can see why a tier did not route.
- As a user I want a hung or crashed Manager/Worker to never deadlock my turn so
  that the completion gate always settles and I get a result or a clear failure.

## Functional Requirements

1. A new enforcement field `RoutingConfig.Enforcement.hierarchy.orchestration_mode`
   MUST be added with the closed value set `{ heuristic, force_manager }` and a
   default of `heuristic`. An absent field MUST resolve to `heuristic` (backward
   compatible with every already-persisted config).
2. `heuristic` mode MUST be byte-identical to the currently shipped behavior: the
   classifier thresholds, the depth ceiling, the silent model fallback, and the
   absence of a Manager persona are all unchanged.
3. `force_manager` mode MUST be gated on Smart Routing activation (`enabled` and
   `mode != never`, mirroring F042/F044/F045) AND on the field being
   `force_manager`. When either gate is closed, behavior is the heuristic default.
4. Under `force_manager`, the ARCHITECT edge MUST classify the child as a Manager
   unconditionally — regardless of work-units, domains, or requested fan-out.
   Non-architect edges MUST remain Worker leaves (a Manager may only ever dispatch
   a Worker; a Worker dispatches nothing).
5. Under `force_manager`, the effective delegation-depth ceiling MUST honor
   `hierarchy.max_depth` so that Architect(0) -> Manager(1) -> Worker(2) passes the
   `tool/task.ts` depth guard. An UNSET `subagent_depth` MUST NOT collapse the
   ceiling below `hierarchy.max_depth`; an explicitly configured `subagent_depth`
   still restricts (the reconciled ceiling is the min of the two). The
   non-hierarchy (plain subagent) path MUST keep the legacy default of 1.
6. The `MAX_DELEGATION_DEPTH` engine ceiling (2) MUST remain authoritative so a
   Worker stays a leaf and cannot spawn a Manager (no infinite delegation).
7. Under `force_manager`, when a tier's role pool model fails to resolve, the
   resolver MUST SURFACE the outcome (a visible warning plus a telemetry
   observation) AND degrade to parent inheritance without blocking or crashing —
   never a silent inheritance. The heuristic path's silent fallback is unchanged.
8. Under `force_manager`, the Manager-role spawn MUST receive a Manager persona
   prelude instructing it to decompose the Architect's task into Worker subtasks,
   dispatch each via `task`, critically aggregate the Worker results, and return a
   consolidated analysis to the Architect. The persona MUST NOT be injected in
   heuristic mode.
9. Manager and Worker tiers MUST resolve their models from their own role pools
   (`role_pools.manager` / `role_pools.worker`) through the SAME provider
   resolution the top-level F037 path uses (`resolveProviderForModel`); no
   divergent resolver.
10. A hung or crashed Manager/Worker MUST NOT deadlock the turn: the F044
    completion gate, `WORKER_MAX_WAIT_MS` bound, and degrade-to-ungated contract
    are inherited unchanged; a failed tier surfaces and never blocks forever.
11. `force_manager` MUST compose with the F043 budget (max_workers / token / cost
    admission still bounds fan-out) and the F044 orchestration completion gate
    (Workers are aggregated before returning to the Architect).
12. The `orchestration_mode` field MUST be readable through the operator surface
    (the F046 shared enforcement-leaf registry) and settable through the same
    scope-aware, CAS-versioned write pipeline as the other hierarchy leaves.

## Security Requirements

- **Data sensitivity/classification.** This feature reads and writes one bounded
  enum policy leaf (`orchestration_mode` ∈ {heuristic, force_manager}) and reads
  the existing routing enforcement/activation config. No secret, credential,
  token, or free-form user content crosses the surface; the classification and
  depth-reconciliation logic operates only on deterministic analyzer signals and
  bounded integers.
- **Authentication/authorization.** No new authenticated surface is introduced.
  The new leaf flows through the SAME F046 operator principal, dispatcher,
  authorization, scope-authority, and CAS pipeline the existing hierarchy leaves
  use; a project write never persists a `global:*` authority. Per-tier model
  resolution reuses the existing provider auth-presence check.
- **Input validation.** The untrusted inputs are the operator-supplied
  `orchestration_mode` value (validated at the write boundary against its closed
  enum, rejected with a typed error otherwise) and the spawn task text (consumed
  only by the deterministic, zero-LLM analyzer; never executed). An absent or
  unknown-shaped field degrades to the safe `heuristic` default, never a crash.
- **Cryptography in transit/at rest.** This feature persists no data requiring
  encryption; it writes one bounded enum leaf to the existing routing
  Config.Service document through the unchanged CAS seam and opens no new
  transport.
- **Logging/audit.** The surfaced `model_unresolved` warning names only the tier
  role and the typed reason — never a model id secret, credential, or task text.
  Telemetry observations carry only bounded role/lifecycle/reason labels. The
  operator write emits the existing bounded, secret-free operator audit event.
- **Error-handling information exposure.** Every failure path — mode gate closed,
  empty role pool, unresolved/unauthenticated provider, engine defect, hung tier —
  degrades to a bounded, secret-free outcome (parent inheritance, a typed blocked
  rejection, or a surfaced degraded warning). No error message carries a secret, a
  raw config fragment, or a stack trace.

## Acceptance Scenarios

Given Smart Routing is enabled and `hierarchy.orchestration_mode` is
`force_manager`
When  the Architect spawns a subagent for a single-clause task
Then  the child is classified as a Manager on the manager role pool, not a direct
      Worker.

Given a `force_manager` Manager at delegation depth 1 with `subagent_depth` unset
and `hierarchy.max_depth` 2
When  the Manager dispatches a Worker
Then  the spawn passes the depth guard (no "Subagent depth limit reached") and the
      Worker runs at depth 2.

Given a `force_manager` Worker leaf at depth 2
When  the Worker attempts to spawn any subagent
Then  the spawn is refused (the Worker is a leaf; `MAX_DELEGATION_DEPTH` holds) and
      no Manager is created.

Given `hierarchy.orchestration_mode` is `heuristic` (or absent)
When  any Architect task spawns a subagent
Then  behavior is byte-identical to the currently shipped binary — the classifier,
      depth ceiling, silent fallback, and no-persona behavior are unchanged.

Given a `force_manager` spawn with an explicit `--model` or an agent-pinned model
When  the child is spawned
Then  the explicit/pinned model wins and the hierarchy resolver is not consulted.

Given a `force_manager` Manager tier whose `role_pools.manager` model cannot
resolve to an authenticated provider
When  the resolver evaluates the tier
Then  a visible warning and a telemetry observation are surfaced, and the tier
      degrades to parent inheritance without blocking or crashing the turn.

Given a `force_manager` foreground Worker that hangs
When  `WORKER_MAX_WAIT_MS` elapses
Then  the Worker is force-aborted, the completion gate settles, and the turn
      returns a bounded error instead of deadlocking.

Given a `force_manager` Manager-role spawn
When  the child session prompt is assembled
Then  the Manager persona prelude (decompose -> dispatch Workers -> aggregate ->
      return to Architect) is prepended to the task prompt.

## Observability

`force_manager` reuses the existing routing telemetry surface. Each tier
dispatch emits the F047 `hierarchy.fanout` observation (parent/child role,
requested/granted fan-out, admitted flag); a tier whose model fails to resolve
emits the same observation with `admitted=false` and the bounded
`model_unresolved` reason, so every admission decision is visible. Worker
terminal outcomes emit the F047 orchestration-worker observation (lifecycle,
delivery, validation verdict). All labels stay bounded to the closed
role/lifecycle/reason sets; no task text, model id, or secret is exported.
Telemetry is exported via OTLP from the application boundary per
`doc/arch/observability/observability.md`.

## Clarifications

- C1 — The `force_manager` architect edge preserves the analyzer-derived
  `requestedFanout` for F043 budget admission (parallel -> `max(workUnits, 2)`,
  else 1); it changes only the child ROLE to Manager, never the budget math.
- C2 — The depth-ceiling honoring is gated to `force_manager` alone. In heuristic
  mode a config-supplied `hierarchy.max_depth` still reconciles to the min with the
  legacy ceiling exactly as it does today, so the heuristic Manager -> Worker hop
  stays blocked (byte-identical).
- C3 — The surfaced `model_unresolved` outcome is a DEGRADED decision (a visible
  warning plus parent inheritance), not a hard block: a missing pool model must
  not stop the turn, only make its cause visible.
</content>
</invoke>
