---
status: accepted
date: 2026-07-22
deciders: [opencode-operator]
consulted: []
informed: []
---

# Collapse The Three Tier Architect Manager Worker Hierarchy

## Context and Problem Statement

ADR-0002 defined hierarchical adaptive routing with maximum depth
Architect → Manager → Worker. Feature 048 added opt-in `force_manager` so every
Architect task could flow through a middle Manager session; Features 049 and 053
wired live dispatch and role-to-agent handoff for that Manager child.

In practice the middle Manager tier failed: extra session hop, depth-ceiling and
persona complexity, brittle Manager→Worker hops under the heuristic default, and
poor operator experience. The desired product model is simpler: **the main
context is both Architect and Manager**, and it only dispatches **Workers**.

## Decision Drivers

- End the failed three-tier Manager-child path without abandoning Smart Routing.
- Keep orchestration (plan, decompose, fan-out, validate, synthesize) in one main
  session labeled `architect`.
- Keep mutation authority only on Worker leaves.
- Reuse F042–F044/F047 engine seams; do not fork a second hierarchy runtime.
- Prefer a clear supersession of ADR-0002/0048 over another opt-in toggle that
  preserves broken three-tier behavior.

## Considered Options

- **Option A — Collapse to main (Architect/Manager) → Workers only; depth 1;
  never spawn `manager` children; supersede force_manager three-tier.** Chosen.
- **Option B — Keep three-tier but fix depth/persona bugs only.** Rejected: the
  middle session itself is the product failure, not only the bugs.
- **Option C — Flat specialist only (no hierarchy roles).** Rejected: fan-out
  admission, orchestration-only main, and Worker mutation boundary remain useful.
- **Option D — New role id `architect_manager` on the wire.** Rejected for V1 of
  this change: unnecessary protocol churn; main stays `architect` with manager
  responsibilities absorbed (product language may say Architect/Manager).

## Decision Outcome

Chosen option: **Option A**.

Concretely:

1. **Hierarchy shape.** Main session role = `architect` (Architect + Manager
   duties). Children = `worker` only. No Manager child sessions.
2. **Depth.** `MAX_DELEGATION_DEPTH = 1`. `hierarchy.max_depth` effective max is 1
   (schema max 1 preferred; clamp legacy 2→1 if dual-read required).
3. **Classifier.** `classifyChildRole` always yields `worker` (fan-out count still
   from analyzer signals). Never `"manager"`.
4. **Engine legality.** Legal edge set: `architect → worker` only. Manager as
   parent produces no children; Worker is a leaf.
5. **force_manager.** Abandoned as a three-tier switch. Stored
   `orchestration_mode: force_manager` maps to the collapsed path (inert) or the
   enum member is removed after compat read — both are acceptable; inert dual-value
   is the lower-churn default for this decision.
6. **Dead paths.** Manager persona on child spawn, Feature 053 manager-child
   interception, and manager-pool requirement for middle-tier spawn are dead for
   live hierarchy dispatch.
7. **Validation.** Worker → main only. Escalation reuses evidence at main and may
   dispatch more Workers; it does not create a Manager child.
8. **Supersession.** This ADR supersedes ADR-0002 and ADR-0048 for hierarchy depth
   and Manager-child rules. ADR-0044 orchestration contract re-homes to main.
   ADR-0053 manager-child handoff path is obsolete for live spawns.

### Consequences

- Good: one orchestration context; simpler depth; aligns with how operators
  actually want to work; reuses existing Worker/budget/completion machinery.
- Good: explicit kill of the failed three-tier product path.
- Bad: operators or tests that asserted Manager children under `force_manager` or
  heuristic multi-domain classification must be updated.
- Bad: `HierarchyRole` may still contain the `manager` literal for protocol
  stability until a later purge — dead on spawn but present in schema.
- Neutral: `role_pools.manager` and `manager_agent` leaves may linger unused until
  a cleanup feature removes them.

## Related

- Feature: [056 Collapse hierarchy](../sdd/056-collapse-the-three-tier-architect-manager-worker-hierarchy/spec.md)
- Supersedes (partial): [0002](0002-core-smart-agent-routing.md),
  [0048](0048-add-an-always-on-three-tier-architect-manager-worker.md)
- Related: [0044](0044-compose-the-hierarchy-orchestration-contract-so-a-manager.md),
  [0053](0053-deterministic-orchestration-handoff-role-to-agent-binding.md)
