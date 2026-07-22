# Tasks: Collapse The Three Tier Architect Manager Worker Hierarchy

## Task Breakdown

- [x] T001 Pure engine collapse (`packages/opencode/src/routing/domain/hierarchy-dispatcher.ts`):
  set `MAX_DELEGATION_DEPTH = 1`; legal children `architect→worker` only,
  `manager→[]`, `worker→[]`; update `planDispatch` comments; retarget
  `planEscalation` so it does not create/require a Manager child path (main replan
  / more workers; keep event compatibility if protocol-frozen). Unit-test illegal
  manager edge and depth-1 leaf.
- [x] T002 Classifier always Worker (`packages/opencode/src/session/routing-hierarchy.ts`):
  `classifyChildRole` always returns `childRole: "worker"` (preserve
  `requestedFanout` math for F043). Remove Feature 048 force_manager manager
  branch and heuristic multi-domain manager warrant. Resolver never produces
  manager lineage for children; `forceManager` flag inert for role selection.
- [x] T003 Task tool + handoff dead paths (`packages/opencode/src/tool/task.ts`,
  `orchestration-handoff.ts`): `applyManagerPersona` no-op; hierarchy
  `reconcileDepthCeiling` effective max 1; `interceptionEligible` never admits
  manager-child handoff on live spawns. Explicit/pinned model still wins.
- [x] T004 Schema bounds (`packages/schema/src/routing/config.ts`,
  `doc/arch/schemas/routing/config.cue` if present): `hierarchy.max_depth` max 1
  (or clamp 2→1 at resolve); document that `orchestration_mode` values are inert
  for three-tier (both map to collapsed path). Update F046 leaf label/help if it
  describes three-tier force_manager.
- [x] T005 Tests: rewrite Feature 048/053 cases that expect manager children in
  `packages/opencode/test/session/routing-hierarchy.test.ts`,
  `packages/opencode/test/tool/task.test.ts`, and related; add F056 scenarios
  (always worker, force_manager no manager child, depth 1, illegal edge).
- [x] T006 Run package checks: `bun test` and `bun typecheck` in
  `packages/opencode` and `packages/schema`; `speckit validate` green.

## Dependencies

- Builds on Features 042–044, 047 (spawn, budget, completion, telemetry) —
  already implemented.
- Supersedes live three-tier behavior from Features 048, 049, 053 (code remains
  until dead paths removed/no-op'd by T002–T003).
- ADR-0056 accepted; no new external services.
