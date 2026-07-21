# Tasks: Wire Per Subagent Hierarchy Delegation Into The Task Spawn

## Task Breakdown

- [x] T001 Confirm the seams and the engine surface by reading the code: the spawn
  seam is `session/prompt.ts` `handleSubtask` (`:280-345`), inheriting the parent model
  at `:292` (`task.model ? getModel(...) : model`, parent `model` from the caller at
  `:1191-1195`); the pure engine is `routing/domain/hierarchy-dispatcher.ts`
  (`planDispatch` / `planEscalation` / `admitDispatchFanout`, legal edges
  `architect → {manager,worker}` / `manager → worker`, `MAX_DELEGATION_DEPTH = 2`); the
  state store is `session/routing-state.ts` `recordDispatch` (dead code); the config is
  `schema/src/routing/config.ts` `RoutingEnforcement.hierarchy` (`max_depth`,
  `orchestration_only`), already persisted in `global:routing`; and the Phase 1 pattern
  to mirror is `session/routing-resolve.ts` (`createRoutingResolver`, timeout, bound
  composition, LRU, provider re-resolution, auth check). Confirm `grep` for
  `HierarchyDispatcher` / `recordDispatch` returns only the domain file + its test.
- [x] T002 Add the session-local resolver
  (`packages/opencode/src/session/routing-hierarchy.ts`):
  `createHierarchyDispatchResolver(deps)` composes the pure `HierarchyDispatcher` engine
  and the Feature 001 routing service over the session Provider / Config / Agent / Auth
  interfaces, running every seam on the captured request context (`Effect.context()` +
  `Effect.runPromiseWith`) so candidate resolution is `InstanceRef`-bound by
  construction. It never touches `createLiveOperatorStack`. (FR-A1)
- [x] T003 Implement the activation gate and read the hierarchy limits: reuse the Phase 1
  read-only `ConfigPort` + `createConfigAdapter` + `resolveEffective`; return `undefined`
  unless `activation.enabled && activation.mode === "auto"`; read
  `enforcement.hierarchy.{max_depth, orchestration_only}` from the same effective config.
  (FR-A2)
- [x] T004 Implement the Architect classifier (zero-LLM): run `createTaskAnalyzer()` over
  the spawn task text and apply the default rule — direct Worker unless
  (`independentWorkUnits >= 2` AND `domainCount >= 2`) OR `requestedFanout > 1`, then
  Manager; a Manager parent forces a Worker child. Export the thresholds as tunable plan
  constants. NO decision-model LLM call by default (bypass). (FR-A5, FR-A6; Clarifications
  C1, C2)
- [x] T005 Enforce legality + depth via `planDispatch`: build the `DispatchRequest` from
  the parent role/depth, the classified child role, the effective budget policy/headroom,
  and the requested fan-out; on `ok:false` map the typed `rejection` to a `{ blocked }`
  outcome; on `ok:true` take `envelope.executionAllowed` and `envelope.lineage` (never
  recompute). Pre-clamp the effective depth ceiling to `min(MAX_DELEGATION_DEPTH,
  hierarchy.max_depth)`. (FR-B1, FR-B2, FR-B3, FR-C2)
- [x] T006 Resolve + verify the child-role model by reusing the Phase 1 machinery: pick a
  model id from `models.role_pools[childRole]`, map it to the lexicographically-smallest
  non-deprecated `providerID` (`resolveProviderForModel`), and verify `Auth.get(providerID)`
  is present — else `undefined` (inheritance). (FR-A4)
- [x] T007 Wire lineage + escalation: call
  `RoutingSessionState.recordDispatch(childSessionId, envelope.lineage)` on every admitted
  spawn (no-op on mismatch, never throws), and expose an
  `escalateWorkerToManager(...)` wrapper over `HierarchyDispatcher.planEscalation` reusing
  lineage/evidence/OutputRefs so the export gains a production call site. (FR-D1, FR-D2,
  FR-F2)
- [x] T008 Make the resolver total and hang-proof: wrap the whole attempt with
  `.catch(() => undefined)` + `Effect.timeoutOrElse({ duration: RESOLVE_TIMEOUT_MS })` +
  a final `Effect.catchCause(() => undefined)`, and cache per-spawn results in a bounded
  LRU. A `{ blocked }` legality outcome survives the wrap as a deliberate typed value.
  (FR-F1)
- [x] T009 Edit the spawn seam (`session/prompt.ts` `handleSubtask`): consult the resolver
  ONLY when neither `task.model` nor the spawned subagent's pinned model is set, and fold
  it in as `explicit ?? agentPinned ?? hierarchyRouted ?? parentModel` around `:292`;
  source `parentRole` from `RoutingSessionState.get(sessionID).hierarchyRole ?? "architect"`
  and `parentDepth` from the `tool/task.ts` parent-chain walk; surface a `{ blocked }`
  outcome as an explicit spawn error (mirroring the `Agent not found` path). Construct the
  resolver once in the layer beside the Phase 1 one. (FR-E1, FR-E2)
- [x] T010 Gate the orchestration-only boundary: thread the `!executionAllowed` +
  `orchestration_only` flag into `taskTool.execute`'s `extra` so `tool/task.ts` extends
  `childToolDenies` (`deriveSubagentSessionPermission`) with the project-mutating /
  test-executing tool classes for a non-Worker child; only a Worker child may mutate/test.
  (FR-C1)
- [x] T011 Reconcile the depth walk (`tool/task.ts:104-117`): keep the `subagent_depth`
  guard as the hard backstop; when hierarchy routing is active the effective ceiling is
  `min(subagent_depth, hierarchy.max_depth)`; preserve the legacy error for the
  disabled-hierarchy path. (FR-E3, FR-B3)
- [x] T012 Add the regression
  (`packages/opencode/test/session/routing-hierarchy.test.ts`) over the resolver with
  faithful Config / Provider / Agent / Auth fakes and the real engine: disabled default →
  `undefined`; enabled + `auto` + populated config → fresh child decision + authenticated
  model; explicit `task.model` short-circuits; Manager→Manager → `illegal_transition`
  block; spawn at `max_depth` → `depth_exceeded` block; `orchestration_only` denies
  mutation to a non-Worker child; `recordDispatch` correlation (and no-op on mismatch);
  unresolved/unauthenticated model → `undefined`; and the classifier boundary
  (single-domain → Worker; ≥2 work-units across ≥2 domains → Manager). No existing
  session/prompt or `tool/task.ts` assertion is weakened. (FR-F3)
- [x] T013 Author the speckit corpus (`spec.md`, `plan.md`, `tasks.md`) and
  `adr/0042-wire-per-subagent-hierarchy-delegation-into-the-task-spawn.md` (recording the
  Phase 1/Phase 2 split, the two resolved defaults — the Architect classifier threshold
  and the decision-model-call bypass — as Considered Options, and the fallback/back-compat
  guarantees), extend the guard scope for the new source/test paths, and leave the gates
  green (`bun test test/session/ test/tool/ test/routing/`, `bunx tsgo --noEmit`, `speckit
  validate`, `speckit analyze`).

## Dependencies

- Feature 037 (Phase 1: the top-level `createRoutingResolver`, its bound composition,
  provider re-resolution, auth-presence check, LRU, and hang/crash-safety contract) —
  mirrored and extended here; already shipped.
- Feature 001 (the pure `HierarchyDispatcher` engine, the `RoutingSessionState` store,
  `createRoutingService`, and the task-analyzer signals) — composed and consumed here;
  already shipped.
- Feature 007 / 014 (the operator control plane + durable `ConfigPort` persistence) — the
  routing/hierarchy config lives under these authorities; already shipped.
- Feature 033 / 034 (the `routing` / `global:routing` scope→authority mapping) — the
  `global:routing` authority that already persists the hierarchy config (`max_depth: 2`,
  `orchestration_only: true`) this runtime reads and enforces; already shipped.

## Residuals (deferred to Phase 3)

- A live decision-model LLM consult for ambiguous classification (Phase 2 stays zero-LLM;
  the consult is a default-off tunable).
- Budget consumption enforcement (`RoutingSessionState.recordConsumption`; turn/worker/
  token limiters).
- Telemetry surfacing of the `hierarchy.dispatch` / `escalation` / `validation` events
  onto OTLP spans/metrics.
- The escalation TRIGGER surface (the runtime signal that fires a Worker → Manager
  escalation); this feature wires the `planEscalation` reuse contract only.
- The operator-stack `InstanceRef` candidate-resolver fix (`operator/stack-live.ts:314/341`).
- `always`-mode hierarchy routing (only `auto` triggers Phase 2).
