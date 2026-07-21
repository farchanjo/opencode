# Tasks: Wire The Hierarchy Dispatch Resolver Into The Live Task Tool

## Task Breakdown

- [x] T001 Add the shared live-seam contract to `session/routing-hierarchy.ts`:
  the `HierarchyDispatchExtra` type (moved out of `tool/task.ts` so both spawn
  paths share it), the `LiveHierarchySpawnInput` / `LiveHierarchyResolution` /
  `LiveHierarchyResolve` types, and the `toHierarchyDispatchExtra(routed, store)`
  helper that builds the F042/F048 dispatch payload ONE way. Re-export
  `ResolvedRoutingModel`.
- [x] T002 Add `createLiveHierarchyResolve(deps)` to `session/routing-hierarchy.ts`:
  a per-invocation closure that applies `shouldConsultHierarchy` (an agent-pinned
  model short-circuits), seeds the per-turn parent role/depth + main-context
  model, calls the SAME `resolveHierarchyDispatch` engine, and reshapes the
  decision into `{ route | blocked | degraded }`.
- [x] T003 Inject the closure into `ctx.extra`: add an optional `hierarchyResolve`
  input to `SessionTools.resolve` (`session/tools.ts`) and place it into every
  tool call's `ctx.extra.hierarchyResolve`.
- [x] T004 Build and pass the closure at the `SessionTools.resolve` call site
  (`session/prompt.ts`): compute the per-turn parent seeds via `parentRoleForSpawn`
  + `walkParentDepth` and the main-context model, then
  `createLiveHierarchyResolve(...)`.
- [x] T005 Consume the closure in `TaskTool.execute` (`tool/task.ts`): when no
  precomputed `hierarchyDispatch` is present and a resolver is injected, resolve
  with THIS spawn's prompt; fail on `blocked`, warn on `degraded`, and on `route`
  apply the routed model precedence (`next.model ?? routed ?? parent`) and the
  dispatch payload. Resolve the child agent early only on this path.
- [x] T006 Refactor `handleSubtask` (`session/prompt.ts`) to build its dispatch
  payload via the shared `toHierarchyDispatchExtra` (remove the inlined object) so
  the mapping lives in one place.
- [x] T007 Fix the secondary gap (`session/prompt.ts` command path): stamp
  `SubtaskPart.model` only when the model is genuinely pinned (`cmd.model` / agent
  model / explicit `--model`); leave it UNSET for an unpinned command so
  `handleSubtask` consults the resolver.
- [x] T008 Live-seam wiring tests (`test/session/routing-hierarchy.test.ts`):
  `createLiveHierarchyResolve` under force_manager routes to `role_pools.manager`
  with a ready dispatch; a pinned agent short-circuits; off/no-route yields
  `undefined`; heuristic single-domain routes a Worker; an over-depth edge is
  blocked; an unresolved manager pool is degraded; plus `toHierarchyDispatchExtra`
  mapping.
- [x] T009 Live-seam consumption tests (`test/tool/task.test.ts`): a routed live
  spawn runs the child on the routed model and records lineage under
  orchestration-only denies; no resolver → parent inheritance (byte-identical); an
  agent-pinned model wins; a blocked decision fails the spawn with no child
  created.
- [x] T010 Gates: `bun test test/session/ test/tool/ test/operator/ test/routing/`
  green; `bunx tsgo --noEmit -p packages/opencode/tsconfig.json` clean; `speckit
  validate --json` → `ok:true`.

## Dependencies

- Composes with the shipped F037 (top-level routing resolution), F042 (hierarchy
  dispatch seam + `resolveHierarchyDispatch`), F043 (budget / fan-out admission),
  F044 (completion gate + `WORKER_MAX_WAIT_MS`), F045 (activation modes), F047
  (telemetry emitters), and F048 (`force_manager` orchestration mode).
- Touches only the two spawn seams and the shared resolver; adds no new engine and
  no new operator config surface (`SubtaskPart.model` was already optional).

## Invariants Preserved

- Default path byte-identical when routing is off / heuristic-no-fanout — the
  resolver returns `undefined` and the seam falls through to the exact current
  `next.model ?? parent` path (`tool/task.ts`).
- Explicit / agent-pinned model always wins via the `shouldConsultHierarchy`
  short-circuit in `createLiveHierarchyResolve`.
- Hang/crash-safe — the resolver retains its `Effect.timeoutOrElse` +
  `Effect.catchCause` degrade-to-undefined wrap; the seam only acts on a positive
  route/blocked/degraded.
- Blocked is not silent — an illegal edge / depth exceeded fails the spawn.
