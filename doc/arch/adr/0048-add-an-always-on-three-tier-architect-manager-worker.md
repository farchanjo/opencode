---
status: accepted
date: 2026-07-21
deciders: [opencode-operator]
consulted: []
informed: []
---

# Add An Always On Three Tier Architect Manager Worker

## Context and Problem Statement

The shipped routing hierarchy is an opportunistic single-hop heuristic. A Manager
tier is created only when a spawn's task text trips `classifyChildRole`'s fan-out
thresholds (`routing-hierarchy.ts`), and even then the Manager -> Worker hop is
blocked because `reconcileDepthCeiling(1, max_depth=2)` collapses the effective
ceiling to 1 (`tool/task.ts`), so `tool/task.ts`'s `depth >= ceiling` guard trips
at the Manager. Two further gaps compound it: an unresolved role-pool model
silently inherits the parent (Architect) model (`routing-hierarchy.ts`
`resolveRoleModel` -> `undefined` -> parent), and there is no persona telling a
Manager to decompose work into Workers.

We want an OPT-IN mode where EVERY Architect task flows unconditionally through
Architect -> Manager -> Worker(s) -> Manager -> Architect, each tier on its own
role pool model — while keeping the existing heuristic as the DEFAULT and
byte-identical (it is "the other option"). The two behaviors must coexist behind a
toggle.

## Decision Drivers

- Byte-identical default: a session with the mode off or absent must behave
  exactly as the currently shipped binary.
- Opt-in, gated: the always-on flow engages only when Smart Routing is active AND
  the operator selects it — never by accident.
- Reuse, do not fork: compose the existing pure engine (`HierarchyDispatcher`),
  F043 budget admission, F044 completion gate, and F037 provider resolution — no
  divergent second path.
- Safety: hang/crash-safe, no deadlock, no infinite delegation; explicit/pinned
  model always wins; a failed tier surfaces rather than silently degrading.

## Considered Options

- **Option A — a single `hierarchy.orchestration_mode` enum toggle whose
  `force_manager` value flips five narrowly-scoped decisions on the existing
  hierarchy path.** The classifier forces a Manager on the Architect edge; the
  depth ceiling honors `hierarchy.max_depth` when `subagent_depth` is unset; an
  unresolved model becomes a surfaced degraded outcome; the Manager-role spawn gets
  a persona prelude; pool resolution reuses the F037 resolver. Each toggle is inert
  in `heuristic` mode.
- **Option B — a parallel always-on orchestration engine alongside the heuristic.**
  A second dispatcher/resolver dedicated to the three-tier flow. Rejected: it
  duplicates the pure engine, the budget admission, and the completion gate, and it
  risks the two diverging — the exact fork the constitution warns against.
- **Option C — make the three-tier flow the default and gate the heuristic behind
  a flag.** Rejected: it violates the byte-identical-default invariant and would
  change the shipped behavior for every existing user.

## Decision Outcome

Chosen option: **Option A**, because a single enum toggle that flips five
narrowly-scoped, individually-gated decisions on the ALREADY-SHIPPED hierarchy
path is the only design that makes the heuristic default a structural no-op
(every `force_manager` branch is guarded, so `heuristic` executes the exact prior
code) while reusing the pure engine, budget admission, completion gate, and
provider resolver without a fork.

Concretely:

- **Schema** (`packages/schema/src/routing/config.ts` + CUE mirror): add
  `orchestration_mode: "heuristic" | "force_manager"` to the `hierarchy` block as
  an OPTIONAL field defaulting to `heuristic`; an absent field resolves to
  `heuristic`, so every persisted config stays valid. `DEFAULT_ROUTING_CONFIG`
  sets it explicitly to `heuristic`.
- **Fix 1 — force-manager classification** (`routing-hierarchy.ts`
  `classifyChildRole`): a new `mode` argument; under `force_manager` the Architect
  edge ALWAYS yields a Manager (preserving the analyzer-derived `requestedFanout`
  for F043 admission), while non-architect edges stay Worker. `heuristic` skips the
  branch entirely.
- **Fix 2 — depth-ceiling reconciliation** (`tool/task.ts`
  `reconcileDepthCeiling`): the reconciler is made `subagent_depth`-aware
  (undefined-preserving) and takes a `forceManager` flag. Under `force_manager`
  with an unset `subagent_depth`, the ceiling is `hierarchy.max_depth` (2) so
  Architect(0) -> Manager(1) -> Worker(2) passes; an explicit `subagent_depth`
  still reconciles to the min. The non-hierarchy path (no `hierarchyDispatch`) and
  the heuristic path both keep the legacy default of 1 — the heuristic Manager ->
  Worker hop stays blocked, byte-identical.
- **Fix 3 — surfaced `model_unresolved`** (`routing-hierarchy.ts`): under
  `force_manager` an unresolved role-pool model returns a typed `degraded`
  decision (reason `model_unresolved`) that `session/prompt.ts` surfaces as a
  visible warning before degrading to parent inheritance. `heuristic` keeps the
  silent `undefined` fallback.
- **Fix 4 — Manager persona** (`tool/task.ts`): under `force_manager`, a
  Manager-role spawn (`lineageStub.child_role === "manager"`) gets the
  `MANAGER_PERSONA_PRELUDE` prepended to its task prompt, instructing it to
  decompose -> dispatch Workers -> aggregate -> return to the Architect. Not
  injected in heuristic mode.
- **Fix 5 — pool resolution** (`routing-hierarchy.ts` `resolveRoleModel`):
  confirmed to reuse the SAME `resolveProviderForModel` the top-level F037 path
  uses; no change beyond a regression test proving the worker pool id resolves on
  the hierarchy path.
- **Operator surface**: `orchestration_mode` is added to the F046 shared
  enforcement-leaf registry as a hierarchy enum leaf, so it is viewable and
  settable through both the `op` CLI and the TUI through the unchanged CAS +
  authority pipeline.

### Consequences

- Good: the heuristic default is a structural no-op — every `force_manager` branch
  is guarded, so turning the mode off (or leaving it absent) runs the exact prior
  code path; the pure engine, budget admission, completion gate, and provider
  resolver are reused, not forked; the three-tier flow finally runs end-to-end.
- Good: the five defects are fixed with pure, unit-testable decision functions
  (classification, depth reconciliation) that a review can check in isolation.
- Bad: the `hierarchy` block gains an enum leaf that the F046 registry, the CUE
  mirror, and the default config must keep in lockstep; a future third mode would
  touch all three.
- Neutral: the surfaced `model_unresolved` warning is intentionally non-blocking —
  it makes the cause visible but still degrades to the Architect model so the turn
  proceeds; an operator who wants a hard stop must configure the role pool.
</content>
