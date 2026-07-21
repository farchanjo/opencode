# Tasks: Wire The Operator Smart Routing Engine Into The Live Session

## Task Breakdown

- [x] T001 Confirm the seam and the engine surface by reading the code: the session
  model-selection seam is `prompt.ts` `createUserMessage`
  (`input.model ?? ag.model ?? currentModel()`) with a mirror in `shellImpl`; the
  Feature 001 engine entry is `createRoutingService(...).evaluate` yielding a bare
  `decision.selection.executor_model`; `resolveEffective` shadows
  `routing`/`global:routing` over a disabled default; the operator stack's
  catalog/agent seams (`stack-live.ts:314/341`) call `AppRuntime.runPromise` WITHOUT
  binding `InstanceRef` (the defect to side-step, not fix).
- [x] T002 Add the session-local resolver
  (`packages/opencode/src/session/routing-resolve.ts`):
  `createRoutingResolver(deps)` composes `createRoutingService` over the session
  Provider / Config / Agent / Auth interfaces, running every seam on the captured
  request context (`Effect.context()` + `Effect.runPromiseWith`) so candidate
  resolution is `InstanceRef`-bound by construction. It never touches
  `createLiveOperatorStack`. (FR-A1)
- [x] T003 Implement the activation gate: read `resolveEffective` (via a read-only
  `ConfigPort` over `Config.get`/`getGlobal` + `createConfigAdapter`) and return
  `undefined` unless `activation.enabled && activation.mode === "auto"`. (FR-A2)
- [x] T004 Evaluate + re-resolve + verify: call `evaluate({ sessionId, turnId,
  taskDescription, taskFingerprint, scope:"session" })`, take
  `decision.selection.executor_model`, map it to the lexicographically-smallest
  non-deprecated `providerID` from `Provider.list()`, and verify `Auth.get(providerID)`
  is present — else `undefined`. Record the decision reference into `RoutingSessionState`.
  (FR-A3, FR-A4, FR-A5, FR-A6)
- [x] T005 Make the resolver total and non-throwing: wrap the whole attempt so any
  error/defect degrades to `undefined`, and cache the FIRST resolution per session
  (including resolved-to-fallback) so the model never flips mid-conversation. (FR-A7, FR-B)
- [x] T006 Edit the session seam (`prompt.ts` `createUserMessage` + `shellImpl` mirror):
  consult the resolver ONLY when neither `input.model` nor `ag.model`/`agent.model` is
  set, and fold it in as `input.model ?? ag.model ?? routed ?? currentModel()`; add a
  `taskTextFromParts` helper; construct the resolver once in the layer and thread
  `Auth.Service` (+ `Auth.node` in the layer deps). (FR-C1, FR-C2)
- [x] T007 Add the regression
  (`packages/opencode/test/session/routing-resolve.test.ts`) over the resolver with
  faithful Config / Provider / Agent / Auth fakes and the real engine: disabled default
  → `undefined`; enabled + `auto` + populated pool → `{ providerID, modelID }`; enabled +
  `never` → `undefined`; empty pool → `undefined`; no provider auth → `undefined`;
  absent-from-catalog model → `undefined`; provider re-resolution determinism; and the
  per-session drift cache (no second evaluation). No existing assertion is weakened. (FR-D)
- [x] T008 Author the speckit corpus (`spec.md`, `plan.md`, `tasks.md`) and
  `adr/0037-wire-the-operator-smart-routing-engine-into-the-live-session.md` (recording
  the explicit authorization lifting the CLAUDE.md guard, the Phase 1/Phase 2 split, the
  session-local composition decision, and the fallback/back-compat guarantees), extend
  the guard scope for the session-test path, and leave the gates green
  (`bun test test/session/ test/routing/ test/operator/`, `bunx tsgo --noEmit`, `speckit
  validate`, `speckit analyze`).

## Dependencies

- Feature 001 (the routing engine `createRoutingService`, the config/catalog/agent
  outbound seams, and the `RoutingSessionState` scaffold) — composed and consumed here;
  already shipped.
- Feature 007 / 014 (the operator control plane + durable `ConfigPort` persistence) —
  the routing config lives under these authorities; already shipped.
- Feature 024 (`routing.configure` persistence) — lets an operator populate a role pool
  to enable this feature; already shipped.
- Feature 033 / 034 (the `routing`/`global:routing` scope→authority mapping + the
  explicit `--scope global` selector) — the effective config this resolver reads;
  already shipped.

## Residuals (deferred to Phase 2)

- Per-subagent hierarchy delegation at the spawn seam (`tool/task.ts`).
- Budget enforcement (turn / worker / token limiters).
- The operator-stack `InstanceRef` candidate-resolver fix (`stack-live.ts:314/341`).
- Telemetry surfacing of the live-session selection.
- `always`-mode implicit routing (only `auto` triggers Phase 1).
