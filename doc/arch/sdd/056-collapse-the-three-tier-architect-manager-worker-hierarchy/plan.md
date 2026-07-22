# Implementation Plan: Collapse The Three Tier Architect Manager Worker Hierarchy

## Overview

Collapse Architect → Manager → Worker into **main (Architect/Manager) → Workers
only**. Main session keeps hierarchy role `architect` but absorbs Manager duties
(plan, decompose, fan-out, validate, synthesize). Never spawn a child with role
`manager`. Max depth = 1. Supersede Feature 048 three-tier `force_manager`
semantics and Feature 053 manager-child handoff for live spawns. Spec:
[spec.md](spec.md); decision: [ADR-0056](../../adr/0056-collapse-the-three-tier-architect-manager-worker-hierarchy.md).

## Technical Approach

Change pure engine first, then classifier/resolver, then task-tool surfaces, then
schema bounds and tests. Prefer **inert dual-value** for `orchestration_mode`
(`heuristic` | `force_manager` both → collapsed path) to avoid breaking persisted
configs. Do not fork a second dispatcher.

### Layers

| Layer | Action |
| ----- | ------ |
| Domain pure engine | `hierarchy-dispatcher.ts`: `MAX_DELEGATION_DEPTH=1`, `LEGAL_CHILDREN.architect=["worker"]`, `manager=[]`; escalation no longer targets manager child |
| Application resolve | `routing-hierarchy.ts`: `classifyChildRole` always `worker`; drop force_manager manager branch; `forceManager` flag becomes dead or always false for child role |
| Task tool | `tool/task.ts`: persona/handoff manager-child paths no-op; `reconcileDepthCeiling` hierarchy path ceiling 1 |
| Orchestration handoff | `orchestration-handoff.ts`: `interceptionEligible` never true for live manager children (no manager children) |
| Schema | `packages/schema/src/routing/config.ts` + CUE: `max_depth` max 1 (or clamp 2→1); document orchestration_mode inert |
| Protocol leaves | F046 leaf help text if any describes three-tier — update to two-tier |
| Tests | Rewrite F048/F053 manager-child expectations; add F056 acceptance tests |

### Key pure changes (sketch)

```ts
// hierarchy-dispatcher.ts
export const MAX_DELEGATION_DEPTH = 1
const LEGAL_CHILDREN = {
  architect: ["worker"],
  manager: [],
  worker: [],
}

// routing-hierarchy.ts
export function classifyChildRole(...): Classification {
  // fanout math retained; role always worker when parent can dispatch
  return { childRole: "worker", requestedFanout }
}
```

### Integration points

- Feature 042 spawn seam (`task` tool + `createLiveHierarchyResolve`) — keep wiring;
  only role/depth outcomes change.
- Feature 043 fan-out admission — unchanged math; always Worker children.
- Feature 044 completion gate — parent is main; still aggregates Workers.
- Feature 047 telemetry — parent architect, child worker, depth ≤ 1.

### Explicit non-goals this plan

- Full purge of `manager` from `HierarchyRole` enum across protocol (later cleanup).
- Removing `role_pools.manager` / `manager_agent` leaves from schema (may stay unused).
- Brain/Smart activation redesign.

## Implementation Sequence

1. **Engine + unit tests** — depth 1, illegal manager child, legal architect→worker.
2. **Classifier + resolver** — always worker; force_manager does not create manager;
   update `routing-hierarchy.test.ts`.
3. **Task tool + handoff** — persona/interception dead; depth ceiling 1 on hierarchy.
4. **Schema/CUE/docs** — max_depth bound; ADR/spec already authored; hierarchy-flow
   companion note under feature dir if needed.
5. **Regression suite** — F048/F049/F053 tests that assert manager children flipped
   to collapsed expectations; package `bun test` for opencode + schema.
6. **Validate** — `speckit validate` green before commit.

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| Tests hard-code manager children | Bulk-update F048/F053 cases in same change set |
| Legacy max_depth=2 configs | Clamp to 1 at read/reconcile; optional degrade observation |
| Escalation event still says reclassified_to manager | Retarget planEscalation to main replan / more workers; keep event shape if protocol-frozen with new reason field only if required |
| Operator docs still teach three-tier | Update operator help leaf labels in same PR if present |

## Companion Artifacts

- `research.md` — optional; prior art is ADR-0002/0048 failure modes (covered in ADR-0056).
- CUE: `doc/arch/schemas/collapse-the-three-tier-architect-manager-worker-hierarchy.cue`
- Gherkin: `doc/arch/specs/features/collapse-the-three-tier-architect-manager-worker-hierarchy.feature`

## Success Criteria

- No hierarchy spawn produces `child_role: manager`.
- `MAX_DELEGATION_DEPTH === 1` and architect→worker is the only legal edge.
- `force_manager` persisted config cannot revive three-tier Manager sessions.
- Existing Worker fan-out + completion gate still pass their package tests.
- `speckit validate` clean for feature 056 artifacts.
