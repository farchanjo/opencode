---
id: 019f8b45-336c-7343-94a7-aea90c67e90f
number: 056
slug: collapse-the-three-tier-architect-manager-worker-hierarchy
status: implemented
created_at: 2026-07-22T19:19:56.012242Z
---
# Feature Specification: Collapse The Three Tier Architect Manager Worker Hierarchy

Feature: 056-collapse-the-three-tier-architect-manager-worker-hierarchy
Created: 2026-07-22

## Summary

The shipped hierarchy allows Architect → Manager → Worker (ADR-0002) with an
opt-in always-on three-tier path (`force_manager`, Features 048/049/053). That
middle Manager session did not work well in practice: extra hop, depth-ceiling
complexity, persona/handoff overhead, and a broken or brittle Manager→Worker path
under the heuristic default.

This feature **collapses** the hierarchy to two roles in practice:

- **Main session** = Architect **and** Manager (one context). It plans, classifies,
  decomposes, admits fan-out, dispatches Workers, validates Worker results, and
  synthesizes the final outcome. Identity remains `architect` on the wire/telemetry.
- **Workers** = only children, only mutators, always leaves.

There is **no** child Manager session. Maximum delegation depth is **1**
(main → Worker). Features 048 (`force_manager`), 049 (live force_manager wiring),
and 053 (manager-role agent handoff) middle-tier paths are **superseded** for
child role classification and spawn: they MUST NOT create a `manager` child.
ADR-0002 and ADR-0048 middle-tier rules are superseded by ADR-0056.

## User Stories

- As a user I want the main context to act as both Architect and Manager so that
  orchestration stays in one conversation without a middle Manager subagent.
- As a user I want every delegated child to be a Worker leaf so that only Workers
  run tools, mutations, and tests against the project.
- As an operator I want `force_manager` and manager-child classification removed
  or made inert so that the failed three-tier path cannot reappear by config.
- As an operator I want fan-out admission, completion gate, and budgets to still
  bound Worker parallelism from main so that orchestration remains safe.
- As a user I want validation to be Worker → main (Architect/Manager) only so that
  results are checked without a Manager intermediate session.
- As an operator I want hierarchy telemetry to show main as `architect` and
  children as `worker` so that Process Table and spans stay legible.

## Functional Requirements

1. **Two-tier model.** Under Smart Routing hierarchy dispatch, the main goal-bearing
   session is the sole orchestrator (Architect + Manager responsibilities). It MUST
   NOT spawn a child with `HierarchyRole` `manager`. Every hierarchy-classified child
   MUST be `worker`.
2. **Role identity.** The main session continues to report hierarchy role
   `architect` (no new enum value required). Manager responsibilities are absorbed
   into that main role; product copy MAY say "Architect/Manager" for the main
   context without inventing a second live role id.
3. **Depth.** Effective maximum delegation depth for hierarchy paths MUST be **1**
   (main → Worker). `HierarchyDispatcher.MAX_DELEGATION_DEPTH` MUST become `1`.
   `hierarchy.max_depth` schema bound MUST be `{1}` only, or if kept as `1|2` then
   any value `> 1` MUST clamp to `1` with a bounded degrade observation (prefer
   schema max `1` + default `1`).
4. **Classifier.** `classifyChildRole` MUST always return `childRole: "worker"`
   for hierarchy edges from main (and for any parent that is not a Worker leaf).
   It MUST never return `"manager"`. Analyzer-derived `requestedFanout` for F043
   admission MUST remain (parallel signals still drive fan-out count, not role).
5. **Legal edges.** `HierarchyDispatcher` legal children MUST be:
   - `architect` → `worker` only
   - `manager` → none (or treated as obsolete parent; no new manager sessions)
   - `worker` → none
   Dispatch of `manager` as child MUST be a typed block (`illegal_edge` or
   equivalent), never a silent re-route to three-tier behavior.
6. **Supersede force_manager.** `orchestration_mode: force_manager` MUST NOT
   create Manager children. Prefer one of:
   - **(A preferred)** remove the enum member after a compat read that maps
     stored `force_manager` → inert (same as collapsed default), or
   - **(B)** keep the field but make both `heuristic` and `force_manager`
     resolve to the collapsed two-tier path (Worker-only children).
   Document the choice in ADR-0056. Byte-identical three-tier behavior is
   **explicitly abandoned**.
7. **Remove manager-child surfaces.** On hierarchy spawn from main:
   - `applyManagerPersona` / `MANAGER_PERSONA_PRELUDE` MUST NOT inject for any
     live path (dead code or no-op).
   - Feature 053 `interceptionEligible` for manager-role children MUST never
     fire (no manager child → no Data/Composer handoff on a Manager session).
   - `manager_agent` binding MAY remain in schema as unused legacy leaf or be
     removed in the same change set; it MUST NOT bind a child Manager session.
8. **Validation chain.** Direct only: Worker result(s) → main (Architect/Manager)
   validation and synthesis. No Worker → Manager session → Architect chain.
   Escalation that previously reclassified into a Manager path MUST reclassify as
   additional Worker dispatch or main-owned replan, reusing evidence/OutputRefs/
   lineage without creating a Manager child.
9. **Mutation boundary.** Main remains orchestration-only when
   `hierarchy.orchestration_only` is true (unchanged contract): only Workers
   execute tools/mutations/tests. Main plans, dispatches, validates, synthesizes.
10. **Budgets and completion.** F043 fan-out admission and F044 orchestration
    completion gate continue to apply to **Workers** parented by main. Hung/
    crashed Workers MUST NOT deadlock main (existing `WORKER_MAX_WAIT_MS` /
    degrade-to-ungated contracts retained).
11. **Role pools.** Worker children resolve from `role_pools.worker` (and
    explicit/pinned model still wins). `role_pools.manager` MUST NOT be required
    for child spawn; it MAY be ignored or reserved for future main-model
    decoration only — not for a middle-tier session.
12. **Operator surface.** Hierarchy enforcement leaves remain F046-managed.
    After this feature, configuring hierarchy MUST NOT re-enable three-tier
    Manager children. Operator docs/help text MUST describe main as
    Architect/Manager → Workers.
13. **Telemetry.** Hierarchy spans/events MUST record parent role `architect`,
    child role `worker`, depth ≤ 1, and fan-out requested/granted. Labels stay
    bounded; no task text or secrets.

## Security Requirements

- **Data sensitivity/classification.** This feature reads/writes hierarchy
  enforcement config (bounded enums/ints: depth, orchestration_mode compat,
  orchestration_only) and spawn classification signals (deterministic analyzer
  outputs). No new secret or free-form user payload surfaces.
- **Authentication/authorization.** No new auth surface. Operator writes reuse
  F046 principal/dispatcher/CAS. Provider resolution for Worker pools reuses
  existing auth-presence checks.
- **Input validation.** Operator enum/int leaves validated at write boundary.
  Spawn task text consumed only by the deterministic zero-LLM analyzer for
  fan-out signals, never executed as code.
- **Cryptography in transit/at rest.** Not applicable — no new encrypted store
  or transport; uses existing Config.Service persistence.
- **Logging/audit.** Telemetry and operator audit carry bounded role/depth/
  reason enums only — never prompts, credentials, or full tool payloads.
- **Error-handling information exposure.** Illegal manager-child attempts and
  depth blocks return typed, secret-free errors. Unresolved worker pool models
  degrade or surface per existing patterns without stack traces or secrets.

## Acceptance Scenarios

Given Smart Routing hierarchy dispatch is active
When  the main Architect session spawns a `task` child for any task text
Then  the child is classified as `worker` (never `manager`) and runs on the
      worker role pool unless an explicit/pinned model wins.

Given `hierarchy.orchestration_mode` is `force_manager` (legacy persisted value)
When  the main session spawns a hierarchy child
Then  no Manager child is created; behavior matches the collapsed two-tier path.

Given a Worker at depth 1
When  the Worker attempts to spawn any subagent via hierarchy dispatch
Then  the spawn is refused (Worker is a leaf; max depth 1).

Given main dispatches multiple Workers under F043 admission
When  Workers complete
Then  main validates and synthesizes results without any intermediate Manager
      session, and F044 completion semantics settle without deadlock.

Given a previously legal Architect → Manager edge is requested by engine input
When  `HierarchyDispatcher.planDispatch` evaluates the edge
Then  the dispatch is blocked as illegal (or never produced by the classifier).

Given hierarchy telemetry is exported
When  a main→Worker dispatch occurs
Then  observations show parent_role=architect, child_role=worker, depth≤1.

## Observability

Reuse Feature 047 hierarchy fan-out and orchestration-worker observations.
After collapse: parent/child roles are only architect→worker; fan-out
requested/granted still emit; `force_manager`-specific manager-child admissions
MUST NOT appear. Metric labels remain bounded enums. Export via OTLP per
`doc/arch/observability/observability.md`.

## Out of Scope

- Redesigning brain/Smart activation modes (Feature 045) beyond hierarchy shape.
- Changing PermissionV2/Policy authorities or operator principal model.
- Removing the `manager` literal from `HierarchyRole` schema in every package
  in one shot if that forces a mass protocol break — prefer dead role with no
  legal spawn first; full enum purge may follow in a later cleanup feature.
- Multi-user / remote orchestration topologies.

## Dependencies and Supersession

| Artifact | Relation |
| -------- | -------- |
| ADR-0002 | Superseded for three-tier depth and Manager child path |
| ADR-0048 | Superseded (`force_manager` three-tier) |
| ADR-0044 | Manager orchestration contract re-homed to **main** |
| ADR-0053 | Manager-child agent handoff path made dead |
| Features 048, 049, 053 | Middle-tier spawn paths superseded |
| Features 042–044, 047 | Reused (spawn, budget, completion, telemetry) with two-tier edges |

## Clarifications

- C1 — Main identity stays `architect` on the wire; "Architect/Manager" is the
  product meaning of that main role after this feature.
- C2 — Three-tier byte-identical default is intentionally abandoned; operators
  who relied on Manager children get Worker-only children instead.
- C3 — Prefer schema `max_depth` maximum 1; if dual-read of old configs is
  needed, clamp 2→1 with a one-shot degrade observation.
