# Implementation Plan: Wire Per Subagent Hierarchy Delegation Into The Task Spawn

## Overview

Feature 037 Phase 1 wired the routing engine into the TOP-LEVEL implicit-default
model of a live session (`session/routing-resolve.ts`, consumed at `prompt.ts`
`createUserMessage` and `shellImpl`). The subagent spawn path was explicitly left for
Phase 2: a Task spawn still inherits the parent model verbatim at
`session/prompt.ts:292` — `const taskModel = task.model ? yield* getModel(...) : model`
(the `: model` tail is the parent model resolved by the caller at
`prompt.ts:1191-1195`). Meanwhile the pure hierarchy engine
(`routing/domain/hierarchy-dispatcher.ts`: `planDispatch` / `planEscalation` /
`admitDispatchFanout`, Architect/Manager/Worker legality, depth ≤ 2) and the state
store (`session/routing-state.ts` `recordDispatch`) are fully unit-tested but have
ZERO production call sites, and the hierarchy config is already persisted in
`global:routing` (`max_depth: 2`, `orchestration_only: true`,
`packages/schema/src/routing/config.ts:88-91`).

This plan adds a session-local hierarchy dispatch resolver
(`session/routing-hierarchy.ts`) that MIRRORS the Feature 037 resolver's composition,
safety, and back-compat contract, and folds a FRESH per-spawn hierarchy decision
(role + depth/path + model) into the `handleSubtask` seam strictly between the pinned
model and the parent-inheritance default. An explicit `task.model` or an agent-pinned
subagent model always wins; the disabled default leaves the spawn seam byte-for-byte
unchanged (still inherits the parent model).

## Confirmed seams (file:line)

- **Spawn seam — the hook point.** `packages/opencode/src/session/prompt.ts`
  `handleSubtask` (`:280-345`). The inheritance line is `:292`:
  `const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model`.
  `taskModel` flows into the child assistant message (`modelID`/`providerID`,
  `:304-305`) and into `taskTool.execute` (`:349-374`). The parent `model` is resolved
  by the caller at `:1191-1195` (`getModel(lastUser.model.providerID, ...)` →
  `handleSubtask({ task, model, ... })`).
- **Phase 1 resolver — the pattern to mirror.**
  `packages/opencode/src/session/routing-resolve.ts` — `createRoutingResolver`
  (`:319`), the `RESOLVE_TIMEOUT_MS = 1500` hang bound (`:313`), the
  `Effect.context()` + `Effect.runPromiseWith` bound-by-construction bridge
  (`:411-412`), the `.catch(() => undefined)` + `Effect.timeoutOrElse` crash/hang
  degrade (`:418-420`), the bounded LRU (`:273-294`), the provider re-resolution
  (`resolveProviderForModel`, `:230-249`), and the auth-presence check (`:393-396`).
  The Phase 1 resolver is constructed once in the layer at `prompt.ts:163-168`.
- **The engine API — what this feature wires.**
  `packages/opencode/src/routing/domain/hierarchy-dispatcher.ts`:
  - `planDispatch(request: DispatchRequest): DispatchOutcome` (`:191`) —
    `DispatchRequest { parent: { sessionId, role, depth }, child: { sessionId, role },
    todo, requestedFanout, policy, headroom, perWorker }`; returns
    `{ ok: true, envelope: { event, lineage, fanout, childDepth, executionAllowed,
    admission } }` or `{ ok: false, rejection: { reason, detail } }` with
    `reason ∈ { illegal_transition, depth_exceeded, parent_not_orchestrator,
    admission_denied }`. Rejects, never throws.
  - `admitDispatchFanout(policy, requestedWorkers, headroom, perWorker):
    FanoutAdmissionResult` (`:101`) — `granted = min(requested, max_workers, cost
    headroom, token headroom)`.
  - `planEscalation(request: EscalationRequest): EscalationPlan` (`:269`) —
    `reclassified_to: "manager"`, reusing evidence/OutputRefs/lineage.
  - `isOrchestrationOnly(role)` (`:48`), `validationEvent(input)` (`:297`),
    `MAX_DELEGATION_DEPTH = 2` (`:35`), legal edges
    `architect → {manager, worker}`, `manager → worker` (`:41-45`).
- **The state store — the dead code to call.**
  `packages/opencode/src/session/routing-state.ts` —
  `recordDispatch(sessionId, lineage): RecordDispatchResult` (`:120-129`, validates the
  child correlation, no-op on mismatch), `recordDecision` (`:116`),
  `recordConsumption` (`:131`), `isDirectChildOf` (`:60`).
- **The depth walk to reconcile.** `packages/opencode/src/tool/task.ts` `:104-117` —
  walks `current.parentID` counting `depth`, fails hard when
  `depth >= (cfg.subagent_depth ?? 1)`. The child permission derivation
  (`deriveSubagentSessionPermission` / `childToolDenies`, `:139-155`) is the
  `orchestration_only` tool-gating point.
- **The config to read + enforce.** `packages/schema/src/routing/config.ts`
  `RoutingEnforcement.hierarchy` (`:88-91`: `max_depth` 1-2, `orchestration_only`
  boolean). Already persisted in `global:routing`.

## Technical Approach

Layers affected: one new resolver file, one seam edit, one dependency thread (all
mirroring Feature 037).

- **New resolver (`packages/opencode/src/session/routing-hierarchy.ts`).**
  `createHierarchyDispatchResolver(deps)` returns
  `resolveHierarchyDispatch(input) → Effect<HierarchyDispatchDecision | undefined>`,
  where `HierarchyDispatchDecision = { childRole: HierarchyRole; model: { providerID,
  modelID }; executionAllowed: boolean; lineage } | { blocked: DispatchRejection }`.
  `input = { parentSessionId, childSessionId, parentRole, parentDepth, taskText }`.
  - **Bound composition (FR-A1).** Inside the returned Effect capture the caller's
    context (`Effect.context()`) and build the `run = Effect.runPromiseWith(context)`
    bridge, exactly as `routing-resolve.ts:411-412`, so every Config/Provider/Agent/Auth
    seam runs `InstanceRef`-bound. Never touch `createLiveOperatorStack`.
  - **Config seam + gate (FR-A2).** Reuse the Phase 1 read-only `ConfigPort`
    (`sessionConfigReadPort`) + `createConfigAdapter` + `toRoutingConfigSource` +
    `resolveEffective`; return `undefined` unless
    `activation.enabled && activation.mode === "auto"`. Read
    `enforcement.hierarchy.{max_depth, orchestration_only}` from the same effective
    config.
  - **Classifier (FR-A5, FR-A6 — Clarifications C1/C2).** Run `createTaskAnalyzer()`
    over `input.taskText` to derive the Feature 001 FR66 signals. Apply the DEFAULT
    rule: `childRole = "worker"` unless (`independentWorkUnits >= WORK_UNIT_THRESHOLD`
    (2) AND `domainCount >= DOMAIN_THRESHOLD` (2)) OR `requestedFanout > 1`, in which
    case `childRole = "manager"`. `WORK_UNIT_THRESHOLD` / `DOMAIN_THRESHOLD` /
    the fan-out floor are exported plan constants (tunable). NO decision-model LLM call
    — the whole classification is deterministic (zero-LLM). A `manager` parent forces
    `childRole = "worker"` (engine legality), so the classifier governs only the
    Architect edge.
  - **Legality via `planDispatch` (FR-B1, FR-B2, FR-C2).** Build the `DispatchRequest`
    from `input.parentRole` + `input.parentDepth`, the classified `child.role`, the
    effective `budget.Policy`, the budget `headroom`, `perWorker` estimate, and
    `requestedFanout`. Call `planDispatch`. On `ok:false` map the `rejection` to a
    `{ blocked }` outcome (the seam surfaces the typed message). On `ok:true` take
    `envelope.executionAllowed` (never recompute it) and `envelope.lineage`. Enforce
    the MIN of `MAX_DELEGATION_DEPTH` and the effective `hierarchy.max_depth` (FR-B3) —
    `planDispatch` already checks `MAX_DELEGATION_DEPTH`; pre-clamp `parentDepth`
    against the config value so a config that widens beyond 2 cannot.
  - **Model resolution (FR-A4) — reuse Phase 1 machinery.** Take a model id from the
    effective `models.role_pools[childRole]` (the Architect maps to the frontier /
    decision pool; Manager and Worker map to their role pools), then reuse the Phase 1
    `resolveProviderForModel` (smallest sorted non-deprecated `providerID`) and the
    `Auth.get(providerID)` presence check. An unresolved/unauthenticated model →
    `undefined` (inheritance fallback).
  - **Lineage record (FR-D1).** On an admitted spawn call
    `RoutingSessionState.recordDispatch(input.childSessionId, envelope.lineage)`. It
    self-validates and is a no-op on mismatch; it never throws.
  - **Escalation reuse (FR-D2).** Expose a thin `escalateWorkerToManager(...)` wrapper
    over `HierarchyDispatcher.planEscalation` so the export gains a production call
    site; carry the lineage/evidence/OutputRefs forward unchanged. The escalation
    TRIGGER is Phase 3. The escalation, capability and todo members of the
    `RoutingEvent` union the dispatch envelope carries are bound by
    `doc/arch/schemas/routing/events-hierarchy.cue`.
  - **Safety (FR-F1).** Wrap the whole attempt exactly as Phase 1: `.catch(() =>
    undefined)` + `Effect.timeoutOrElse({ duration: RESOLVE_TIMEOUT_MS, orElse:
    undefined })` + a final `Effect.catchCause(() => undefined)`; per-spawn results are
    cached in a bounded LRU keyed on child session id. A `{ blocked }` outcome is a
    deliberate typed value that survives the wrap (it is not a crash).
- **Spawn seam (`packages/opencode/src/session/prompt.ts` `handleSubtask`).** Before
  `:292`, in the implicit branch only, consult the resolver:
  `const routed = (task.model || subagentPinned) ? undefined : yield*
  resolveHierarchyDispatch({ parentSessionId: sessionID, childSessionId: <derived>,
  parentRole, parentDepth, taskText: task.prompt })`. Then
  `const taskModel = task.model ? yield* getModel(...) : (routed?.model ?
  yield* getModel(routed.model.providerID, routed.model.modelID, sessionID) : model)`
  — i.e. `explicit ?? agentPinned ?? hierarchyRouted ?? parentModel` (FR-E1, FR-E2).
  When `routed` is a `{ blocked }` outcome, surface the typed rejection as the spawn
  error (mirroring the existing `Agent not found` error path at `:339-345`) instead of
  inheriting. `parentRole` comes from `RoutingSessionState.get(sessionID).hierarchyRole
  ?? "architect"` (the primary/root context is the Architect); `parentDepth` from the
  `tool/task.ts` parent-chain walk value.
  When `orchestration_only` and the child is a non-Worker (`!executionAllowed`), thread
  a flag into `taskTool.execute`'s `extra` so `tool/task.ts` extends `childToolDenies`
  with the mutating/execution tool classes (FR-C1) — the gating happens where the child
  permission ruleset is derived.
- **Depth reconciliation (`packages/opencode/src/tool/task.ts`, FR-E3).** Keep the
  `subagent_depth` walk as the hard backstop; when hierarchy routing is active the
  effective ceiling is `min(subagent_depth, hierarchy.max_depth)`. The legacy error is
  preserved for the disabled-hierarchy path.
- **Dependency thread.** The resolver needs Config / Provider / Agent / Auth — all
  already resolved in the `SessionPrompt` layer for Phase 1 (`prompt.ts:163-168`), plus
  the `RoutingSessionState` store (already imported by `routing-resolve.ts`). Construct
  the hierarchy resolver once in the layer beside the Phase 1 one; no new layer deps.

Back-compat (FR-E2, FR-F3): with the disabled default the resolver returns `undefined`
at the first gate, so `task.model ? getModel(...) : (undefined ?? model)` is exactly
today's `task.model ? getModel(...) : model` — byte-identical.

## Test strategy (FR-F3)

`packages/opencode/test/session/routing-hierarchy.test.ts` drives
`createHierarchyDispatchResolver` over faithful Config / Provider / Agent / Auth fakes
and the REAL pure engine + Feature 001 routing service (in-memory decision store),
proving: (a) disabled default → `undefined`; (b) enabled + `auto` + populated hierarchy
config → a fresh child decision with a role + authenticated model; (c) explicit
`task.model` short-circuits; (d) Manager-parent → Manager child → `illegal_transition`
block; (e) a spawn at `max_depth` → `depth_exceeded` block; (f) `orchestration_only`
denies mutation to a non-Worker child; (g) `recordDispatch` correlates parent ↔ child
(and a mismatched lineage is a no-op); (h) unresolved/unauthenticated model →
`undefined`; and the Architect classifier boundary (single-domain → direct Worker;
≥2 work-units across ≥2 domains → Manager). Existing `test/session/prompt.test.ts`,
`test/tool/task.test.ts`, and `test/routing/**` assertions are unchanged.

## Hang / crash-safety contract

Restated verbatim from Feature 037 (`routing-resolve.ts` header): the hierarchy
resolver can NEVER crash OR block the spawn path. Every FAILURE mode — Smart Routing
disabled, gated closed, an empty pool, no authorized candidate, an unresolved or
unauthenticated provider, or any evaluate/engine error or defect — degrades to
`undefined`, which the seam treats as "inherit the parent model" (today's behavior).
The whole attempt is wrapped so any defect or rejection resolves without throwing, AND
it is raced against a hard `RESOLVE_TIMEOUT_MS` (1.5s) bound so a slow/locked
filesystem hangs nothing — a timeout degrades to `undefined` exactly like every other
failure. Retention is bounded (LRU) so a long-lived `opencode serve` process cannot
leak per-spawn state. Selection completes BEFORE the child session's assistant message
is created — never inside the child's LLM stream. A LEGALITY block
(`illegal_transition` / `depth_exceeded` / `parent_not_orchestrator`) is the ONE
non-`undefined` outcome: a deliberate, typed value that the seam surfaces as an
explicit blocked spawn — it is not a crash and never leaks a secret.

## Companion Artifacts

No companion files are required: this feature introduces no new entity, external
contract, or integration — it composes the existing pure `HierarchyDispatcher` engine,
the Feature 001 routing service, and the `RoutingSessionState` store over the
session-layer interfaces and folds the result into one seam. The optional
`research.md` / `data-model.md` / `contracts/` / `quickstart.md` are intentionally
omitted (the Domain Model section in `spec.md` carries the flow diagram); the
`.feature` / `.cue` scaffolds follow the 024-041 convention.
