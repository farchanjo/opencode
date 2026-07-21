---
id: 019f82b2-8cae-7090-876a-48aabf40c581
number: 042
slug: wire-per-subagent-hierarchy-delegation-into-the-task-spawn
status: specified
created_at: 2026-07-21T03:22:47.342655Z
---
# Feature Specification: Wire Per Subagent Hierarchy Delegation Into The Task Spawn

Feature: 042-wire-per-subagent-hierarchy-delegation-into-the-task-spawn
Created: 2026-07-21
Scope: the Task subagent spawn seam
(`packages/opencode/src/session/prompt.ts` `handleSubtask`, ~:280-345, where a
subtask model is chosen at :292) and a new hierarchy-aware dispatch resolver
(`packages/opencode/src/session/routing-hierarchy.ts`) that composes the already
unit-tested pure engine `routing/domain/hierarchy-dispatcher.ts`
(`planDispatch` / `planEscalation` / `admitDispatchFanout`, role/depth legality)
and the dead-code `session/routing-state.ts` `recordDispatch` into the live spawn
path. Feature 037 Phase 1 wired the TOP-LEVEL implicit-default model only
(`session/routing-resolve.ts`, consumed at `prompt.ts` `createUserMessage` :690 and
`shellImpl` :500); the subagent spawn path still inherits the PARENT model verbatim
(`prompt.ts:292` `task.model ? getModel(...) : model`). This feature is Feature 037
**Phase 2** for the delegation dimension: give a subagent spawn a FRESH per-spawn
hierarchy routing decision (role + delegation depth/path) instead of parent-model
inheritance, enforcing the Architect → Manager → Worker legality and the
`orchestration_only` execution boundary that already exist in the pure engine and in
the persisted `global:routing` config (`max_depth: 2`, `orchestration_only: true`).

The pure engine and the state store are already unit-tested but have ZERO production
call sites: `grep` for `HierarchyDispatcher` / `recordDispatch` returns only the
domain file and its test. This feature is the wiring that gives them their first
production consumers.

## Phasing

- **Phase 1 (Feature 037, shipped).** Wire the routing engine into the top-level
  implicit-default model of a live session (`routing-resolve.ts`). Subagent spawns
  were explicitly out of scope (037 "Out of Scope": "a subagent still inherits its
  parent's model").
- **Phase 2 (this feature).** Wire per-subagent HIERARCHY delegation into the Task
  spawn seam: a fresh per-spawn role + depth/path decision, role-legality and
  depth-limit enforcement via `HierarchyDispatcher`, the `orchestration_only`
  tool-execution boundary, and `recordDispatch` lineage correlation.
- **Phase 3+ (out of scope, noted in ADR-0042).** A live decision-model LLM consult
  for ambiguous classification (Phase 2 stays zero-LLM by default); budget
  consumption enforcement (`recordConsumption`); telemetry surfacing of the dispatch
  envelope; the operator-stack `InstanceRef` candidate-resolver fix.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — A subagent spawn gets a fresh hierarchy decision, not parent inheritance

- As a user who has enabled Smart Routing in `auto` mode with a populated hierarchy
  config, I want a Task spawn where I did NOT pin `task.model` to receive a FRESH
  per-spawn routing decision (a hierarchy role and a model chosen for that role),
  instead of silently inheriting the parent session's model, so the hierarchy policy
  I configured actually governs delegated work.

### P1 — An explicit or agent-pinned subagent model always wins

- As a user, I want an explicit `task.model` (or an agent-pinned model on the
  spawned subagent) to ALWAYS be honored verbatim, never overridden by the hierarchy
  resolver, so hierarchy routing can only ever fill the IMPLICIT default of a spawn.

### P1 — Role and depth legality are enforced at the spawn

- As a maintainer, I want the Architect → Manager → Worker legality enforced at the
  spawn seam — a Manager may not spawn a Manager, a Worker may not spawn anything, an
  Architect may spawn a Worker directly, and a spawn exceeding `hierarchy.max_depth`
  is blocked with an explicit typed outcome — so illegal or runaway delegation cannot
  be created by a model, a plugin, or a nested instruction.

### P1 — Orchestrators never mutate; only Workers execute

- As a maintainer, I want `orchestration_only = true` to mean Architect and Manager
  spawns carry NO project-mutating / test-executing tool authority — only a Worker
  child may mutate the tree or run tests — so the orchestration tier stays advisory
  and execution authority is confined to the leaf.

### P2 — Dispatch lineage is correlated parent ↔ child

- As a maintainer, I want each hierarchy spawn to record its parent ↔ child session
  correlation through `RoutingSessionState.recordDispatch`, and a direct Worker that
  escalates to a Manager path to reuse its lineage and evidence rather than
  restarting blind, so the delegation graph is observable and escalation does not
  re-derive work already done.

### P1 — Disabled hierarchy routing changes nothing (back-compat)

- As a maintainer, I want the default configuration (Smart Routing disabled, or the
  hierarchy resolver returning no decision) to leave the spawn seam byte-for-byte
  identical to today — the subagent still inherits the parent model — so shipping
  this feature is inert until an operator explicitly enables `auto` hierarchy routing
  with a real config.

## Functional Requirements

### Group A — the hierarchy dispatch resolver (FR-A)

1. **FR-A1 — a session-local hierarchy resolver, bound by construction.** A new
   resolver (`session/routing-hierarchy.ts#createHierarchyDispatchResolver`) MUST
   compose the pure `HierarchyDispatcher` engine and the Feature 001 routing service
   over the session-layer service INTERFACES (Provider / Config / Agent / Auth),
   running every outbound async seam on the context CAPTURED inside the caller's
   Effect (`Effect.context()` + `Effect.runPromiseWith`), exactly as Feature 037's
   `createRoutingResolver` does, so candidate resolution is `InstanceRef`-bound BY
   CONSTRUCTION and the operator-stack `InstanceRef` defect is never reached. It MUST
   NOT reach into `createLiveOperatorStack`.

2. **FR-A2 — the activation gate.** The resolver MUST read the effective routing
   config (`routing` shadows `global:routing` shadows the disabled default, via the
   Feature 001 `resolveEffective`) and return `undefined` (→ parent-model
   inheritance) unless `activation.enabled === true` AND `activation.mode === "auto"`.
   This is the sole trigger for hierarchy delegation.

3. **FR-A3 — a fresh per-spawn decision.** When gated open, the resolver MUST produce
   a FRESH decision per spawn: (a) classify the spawn's task text into a CHILD role
   (Worker or Manager) via the Architect classifier (FR-A5), (b) validate the
   parent → child edge through `HierarchyDispatcher.planDispatch`, and (c) resolve a
   concrete model for the child role. The decision MUST NOT be the parent's model by
   inheritance; it is derived independently for this spawn.

4. **FR-A4 — model resolution + auth verification (reuse Phase 1).** The child-role
   model MUST be resolved from the role pool for that role and mapped to a concrete
   `providerID` deterministically (the lexicographically-smallest non-deprecated
   provider exposing it, `Provider.list()`), then verified authenticated via
   `Auth.get(providerID)` — reusing the Feature 037 provider-re-resolution and
   auth-presence machinery. An unresolved or unauthenticated model MUST degrade to
   `undefined` (→ parent inheritance), never break the spawn.

5. **FR-A5 — the Architect classifier (direct-Worker default, Manager on fan-out).**
   The primary context is the Architect. For each spawn the Architect MUST classify
   the child role from the deterministic Feature 001 task-analyzer signals
   (Feature 001 FR66: domain count, independent work-units, mutation/risk, ambiguity,
   context size, expected tools, parallelism). The RESOLVED DEFAULT rule (conservative,
   tunable — see Clarifications C1): dispatch a **direct Worker** unless the spawn
   presents **≥ 2 independent work-units spanning ≥ 2 distinct domains, OR a requested
   parallel fan-out > 1**, in which case dispatch a **Manager** (which then fans out to
   Workers). A Manager parent MAY only ever dispatch a Worker (engine legality), so the
   classifier is consulted for the ARCHITECT edge; Manager → Worker is forced.

6. **FR-A6 — decision-model call bypass (zero-LLM default).** The classification MUST
   NOT invoke a live decision-model LLM by default: it runs entirely on the
   deterministic analyzer signals (Feature 001 FR17 fast/unambiguous route). A live
   decision-model consult is a documented, DEFAULT-OFF tunable engaged only when the
   analyzer's ambiguity signal crosses a threshold (deferred to Phase 3 — see
   Clarifications C2). Phase 2 keeps the whole spawn-routing path zero-LLM.

6-bis. **FR-A7 — the Architect model is the main-context selection; the pool is a
   configurable fallback (see Clarifications C4).** The ARCHITECT is the primary/root
   session, and its model MUST be the MAIN-CONTEXT SELECTED model — the model the
   primary session is running as (`input.model ?? agent.model ?? the session-selected
   model`). The routing engine MUST NOT override the Architect's model. Any
   architect-tier model resolution MUST prefer the main-context model FIRST; only when
   NO main-context model resolves does it fall back to `role_pools.architect` (resolved
   via `decision_model.pool`, per FR-A4), then `role_pools[fallback.floor_role]`, then
   the static provider default. The precedence is therefore:
   `explicit --model / agent-pinned ▶ main-context selected model ▶ role_pools.architect ▶ role_pools[floor_role] ▶ static default`.
   `role_pools.architect` is a FIRST-CLASS, generic, configurable role pool — settable
   exactly like `manager` / `worker` via the same `pools.set` mechanism, never
   special-cased. Manager and Worker tiers keep resolving from `role_pools.manager` /
   `role_pools.worker` unchanged. Explicit `--model` and agent-pinned models always
   win. This reconciles Feature 037 Phase 1 (top-level implicit routing): the top-level
   Architect session keeps the main-context/default model and the pool is only the
   fallback. Acceptance hook AC "Architect keeps the main-context model".

### Group B — role and depth legality (FR-B)

7. **FR-B1 — legal edges only, via `planDispatch`.** Every spawn's parent → child
   edge MUST be admitted by `HierarchyDispatcher.planDispatch`, which rejects (never
   throws) an illegal transition: `architect → {manager, worker}` and
   `manager → worker` are the ONLY legal edges. A `manager → manager`, a
   `worker → *`, or any dispatch by a non-orchestrator role yields a typed
   `DispatchRejection` (`illegal_transition` / `parent_not_orchestrator`), which the
   seam surfaces as an explicit blocked spawn — not a silent inheritance.

8. **FR-B2 — depth limit, via `planDispatch` + `hierarchy.max_depth`.** A spawn whose
   child delegation depth (`parent.depth + 1`) would exceed the effective
   `hierarchy.max_depth` (persisted `2` = Architect → Manager → Worker) MUST be
   rejected by `planDispatch` with a typed `depth_exceeded` outcome and blocked with
   an explicit message — not silently allowed and not silently inherited. The parent's
   role and depth MUST be sourced from `RoutingSessionState` (role) and the existing
   `tool/task.ts` parent-chain walk (edges from the root), reconciled per FR-E3.

9. **FR-B3 — the `MAX_DELEGATION_DEPTH` invariant is authoritative.** The pure
   engine's `MAX_DELEGATION_DEPTH = 2` and the effective `hierarchy.max_depth` MUST
   agree; the runtime MUST enforce the SMALLER of the two if they ever diverge, so a
   config can never widen delegation beyond the engine invariant.

### Group C — orchestration-only execution boundary (FR-C)

10. **FR-C1 — only a Worker child carries execution authority.** When
    `hierarchy.orchestration_only === true`, an Architect or Manager child spawn MUST
    be gated to carry NO project-mutating or test-executing tool authority; only a
    Worker child (`planDispatch` envelope `executionAllowed === true`, true iff
    `child.role === "worker"`) may mutate the tree or run tests. The tool-gating point
    is the child session's derived permission ruleset at the spawn seam
    (`tool/task.ts` `deriveSubagentSessionPermission` / `childToolDenies`), extended
    to deny the mutating/execution tool classes for a non-Worker child.

11. **FR-C2 — the boundary is engine-derived, not re-decided.** The execution-allowed
    flag MUST be taken from the `planDispatch` envelope (`executionAllowed`), never
    recomputed at the seam, so the boundary and the dispatch decision cannot diverge.

### Group D — lineage correlation and escalation (FR-D)

12. **FR-D1 — record the dispatch lineage per spawn.** On every admitted spawn the
    resolver MUST call `RoutingSessionState.recordDispatch(childSessionId, lineage)`
    with the `planDispatch` envelope's lineage (parent/child session ids + roles),
    correlating the child session to its parent edge. `recordDispatch` self-validates
    the child correlation and is a no-op on a mismatch (state unchanged) — it MUST NOT
    throw into the spawn path.

13. **FR-D2 — escalation reuses lineage and evidence.** A direct Worker that must
    escalate to a Manager path MUST reuse `HierarchyDispatcher.planEscalation`, which
    carries the originating lineage, the Worker's evidence refs, and its OutputSpool
    refs forward unchanged (`reclassified_to: "manager"`), so the reclassified Manager
    dispatch reuses the Worker's work instead of re-deriving it. (The escalation
    TRIGGER surface is Phase 3; the reuse contract is specified here so the engine
    export gains its production call site.)

### Group E — the spawn seam and reconciliation (FR-E)

14. **FR-E1 — inject the hierarchy model only in the implicit branch.** The spawn seam
    (`prompt.ts` `handleSubtask` :292) MUST consult the resolver ONLY when neither an
    explicit `task.model` NOR an agent-pinned model on the spawned subagent is set,
    and fold the result strictly between the pinned model and the parent-inheritance
    default: `task.model` (resolved) `?? agentPinned ?? hierarchyRouted ?? parentModel`.
    An explicit or agent-pinned model is NEVER overridden. Today's line
    (`task.model ? getModel(...) : model`) becomes the `?? parentModel` tail unchanged.

15. **FR-E2 — a `undefined` result is the unchanged inheritance path.** When the
    resolver returns `undefined` (disabled, gated closed, unresolved/unauthenticated,
    or any fallback), the spawn MUST inherit the parent `model` EXACTLY as today, with
    no observable change.

16. **FR-E3 — reconcile the depth walk with the hierarchy limit.** The legacy
    `tool/task.ts` nesting-depth guard (`depth >= (cfg.subagent_depth ?? 1)`,
    :104-117) MUST be reconciled with `hierarchy.max_depth`: when hierarchy routing is
    active, the `HierarchyDispatcher` depth rule (FR-B2) is the authoritative
    delegation bound, and the `subagent_depth` guard remains a hard backstop (the
    effective ceiling is the MINIMUM of the two). The legacy error path is preserved
    for the disabled-hierarchy case.

### Group F — back-compat and safety proof (FR-F)

17. **FR-F1 — total, non-throwing, hang-proof fallback.** The resolver MUST mirror the
    Feature 037 safety contract EXACTLY: it can NEVER crash OR block the spawn path.
    Every failure mode — disabled, gated closed, engine error, an illegal/depth
    rejection surfaced as a block, an unresolved/unauthenticated provider, or any
    defect — degrades to a deterministic outcome (`undefined` → parent inheritance, or
    an explicit typed block for a legality violation). The whole attempt is wrapped so
    any cause resolves without throwing AND is raced against a hard timeout
    (`RESOLVE_TIMEOUT_MS`, 1.5s) so a slow/locked filesystem hangs nothing. Retention
    is bounded (LRU), as in Phase 1.

18. **FR-F2 — the engine exports gain production call sites.** After this feature,
    `grep` for `HierarchyDispatcher.planDispatch` / `planEscalation` /
    `admitDispatchFanout` and `RoutingSessionState.recordDispatch` MUST return the new
    production seam, not only the domain file and its test.

19. **FR-F3 — proven over the resolver with real services.** Regression coverage MUST
    drive `createHierarchyDispatchResolver` over faithful Provider / Config / Agent /
    Auth fakes and the real engine, proving: (a) the disabled default → `undefined`
    (parent inheritance); (b) enabled + `auto` + a populated hierarchy config → a
    fresh child decision with a role and a resolved model; (c) an explicit `task.model`
    short-circuits the resolver; (d) a Manager-parent → Manager child edge is rejected
    (`illegal_transition`); (e) a spawn at `max_depth` is rejected (`depth_exceeded`);
    (f) `orchestration_only` denies mutation to a non-Worker child; (g) `recordDispatch`
    correlates parent ↔ child; (h) an unresolved/unauthenticated model → `undefined`.
    No existing session/prompt or `tool/task.ts` assertion is weakened.

## Non-Functional Requirements

- **Zero behavior change by default.** With the disabled-by-default config the
  resolver returns `undefined` at the first gate, so the spawn seam is byte-identical
  to today — the subagent inherits the parent model, no new provider/model call, no
  token cost, no latency on the default path.
- **The spawn path is never blocked or crashed by the resolver.** The routing attempt
  is wrapped so any error/defect degrades deterministically, and it is consulted
  before the child session's assistant message is created — never inside the child's
  LLM stream. A LEGALITY block (illegal edge / depth exceeded) is a deliberate, typed
  outcome, distinct from a crash.
- **One engine, one config SSOT.** The resolver reuses the pure `HierarchyDispatcher`,
  the Feature 001 routing service, and the `routing` / `global:routing` config
  authorities; it introduces no parallel engine, config store, or role/depth rules.
- **Determinism.** The classifier is deterministic (analyzer signals, zero-LLM by
  default), provider re-resolution is deterministic (sorted `providerID`), and the
  role/depth legality is the pure engine's — so a spawn's decision is reproducible.

## Security Requirements

- **Data sensitivity/classification.** The resolver reads the routing configuration
  document (operator metadata: activation flags, role pools, hierarchy limits), the
  live provider catalog (model ids + status), and the subagent's task text; it queries
  `Auth.get(providerID)` ONLY for a boolean "is this provider authenticated" decision.
  It never reads, logs, returns, or persists credential material. Lineage records hold
  only session ids and roles — no payload, no secret.
- **Authentication/authorization.** No new authenticated surface. This feature
  NARROWS authority: `orchestration_only` REMOVES project-mutating and test-executing
  tool authority from Architect/Manager child spawns (FR-C1), and an unauthenticated
  routed provider is REFUSED (falls back to inheritance). It can only ever confine, or
  fill an implicit default that never overrides an explicit choice — never widen what a
  spawn may run.
- **Input validation.** The untrusted input is the subagent's task text, passed ONLY
  to the Feature 001 deterministic, model-free analyzer (zero LLM at classification)
  and used to pick a role; it never reaches a model at selection time. The routing
  config is decoded through the Feature 001 schema; a malformed document fails the
  decode and falls back to the safe default. Fan-out counts are admission-controlled
  by `admitDispatchFanout` (min of requested / max_workers / cost / token headroom),
  so a hostile or runaway fan-out request cannot spawn an unbounded worker set.
- **Cryptography in transit/at rest.** Not applicable — the resolver performs no new
  network I/O and persists no new at-rest data beyond the Feature 001 decision record
  (already redacted, written through the existing decision store). It moves no secret.
- **Logging/audit.** No new logging of sensitive material. Dispatch lineage is
  correlated in the in-memory `RoutingSessionState`; no config payload or credential
  is written to a log line.
- **Error-handling information exposure.** A resolver FAILURE collapses to a plain
  `undefined` (inheritance fallback) — no stack trace, config fragment, or auth
  detail surfaced. A LEGALITY block surfaces only the typed engine reason
  (`illegal_transition` / `depth_exceeded` / `parent_not_orchestrator` + its plain
  detail string), which names no secret.

## Acceptance Scenarios

Given the hierarchy dispatch resolver composed over the Provider / Config / Agent /
Auth interfaces, with the pure `HierarchyDispatcher` engine and the Feature 001
routing service, and a `handleSubtask` spawn where `task.model` is unset

- **Disabled default → parent inheritance unchanged (FR-A2, FR-E2, FR-F3-a).**
  Given the disabled default routing config (mode `never`),
  When `handleSubtask` selects the subtask model,
  Then the resolver returns `undefined` and the spawn uses the parent `model` exactly
  as `prompt.ts:292` does today.

- **Enabled + auto → fresh child decision (FR-A3, FR-A4, FR-F3-b).**
  Given `routing` is enabled in `auto` mode with a populated hierarchy config and role
  pools, and the parent context is the Architect,
  When a spawn with a single-domain task is classified,
  Then the resolver returns a direct-Worker decision with a role-appropriate,
  authenticated model — NOT the parent's model by inheritance.

- **Cross-domain fan-out → Manager path (FR-A5).**
  Given a spawn whose task text presents ≥ 2 independent work-units across ≥ 2 domains,
  When the Architect classifies it,
  Then the child role is Manager (which then fans out to Workers under
  `admitDispatchFanout`), not a direct Worker.

- **Explicit `task.model` → resolver never consulted (FR-E1).**
  Given `task.model` (or an agent-pinned subagent model) is set,
  When `handleSubtask` selects the model,
  Then the routed branch short-circuits and the explicit/agent model is used verbatim.

- **Architect keeps the main-context model (FR-A7, C4).**
  Given the primary/root session (the Architect) has a main-context selected model
  and Smart Routing is enabled in `auto` mode,
  When the Architect's implicit-default model is resolved,
  Then the main-context selected model is used — NOT `role_pools.architect` — and the
  routing engine does not override it; with NO main-context model resolvable the
  resolution falls back to `role_pools.architect`, then `role_pools[floor_role]`, then
  the static default. Manager/Worker tiers resolve from their own pools unchanged.

- **Manager may not spawn Manager (FR-B1, FR-F3-d).**
  Given the parent session's role is Manager,
  When a spawn would classify the child as Manager,
  Then `planDispatch` rejects with `illegal_transition` and the spawn is blocked with
  an explicit typed message.

- **Depth over the limit is blocked (FR-B2, FR-F3-e).**
  Given a Worker parent already at delegation depth 2 (`hierarchy.max_depth`),
  When it attempts any spawn,
  Then `planDispatch` rejects with `depth_exceeded` and the spawn is blocked — never
  silently inherited.

- **Orchestrator child cannot mutate (FR-C1, FR-F3-f).**
  Given `orchestration_only = true` and a Manager child spawn,
  When the child session's permission ruleset is derived,
  Then project-mutating and test-executing tool classes are denied to the Manager
  child; only a Worker child (`executionAllowed`) may mutate or test.

- **Lineage correlated per spawn (FR-D1, FR-F3-g).**
  Given an admitted Architect → Worker spawn,
  When the resolver records the dispatch,
  Then `RoutingSessionState.recordDispatch(child, lineage)` correlates the child
  session to its parent and stores the child role, and a mismatched lineage is a no-op.

- **Unauthenticated routed model → inheritance (FR-A4, FR-F3-h).**
  Given the child-role pool model resolves to a provider with no credential,
  When the resolver runs,
  Then it returns `undefined` and the spawn falls back to the parent model.

## Observability

Phase 2 adds no new metrics, log events, or trace spans. The `HierarchyDispatcher`
already emits the `hierarchy.dispatch` / `hierarchy.escalation` / `hierarchy.validation`
event VALUES as plain typed data; surfacing them onto the OTLP telemetry seam (spans /
metrics for the dispatch envelope) is deferred to Phase 3. The behavioral change is
confined to WHICH model and role a subagent spawn selects, and only when Smart Routing
is explicitly enabled in `auto` mode. Conventions live in
`doc/arch/observability/observability.md`.

## Domain Model

The resolver composes the pure engine and the Feature 001 service over the session
interfaces and folds its result into the spawn seam:

```
handleSubtask (session/prompt.ts:280-345)
  routed = (task.model || subagent.model) ? undefined
         : resolveHierarchyDispatch({ parentSessionId, childSessionId,
                                      parentRole, parentDepth, taskText })   (FR-E1)
  taskModel = getModel(task.model) ?? subagent.model ?? routed ?? parentModel  (FR-E1, FR-E2)
        |
        v
resolveHierarchyDispatch (session/routing-hierarchy.ts)
  context = Effect.context()  (carries request InstanceRef)                 (FR-A1)
  resolveEffective()  (routing > global:routing > disabled default)
     not (enabled && mode=="auto") -> undefined                            (FR-A2)
  childRole = ArchitectClassifier(analyzerSignals)                         (FR-A5)
     direct Worker unless (>=2 work-units AND >=2 domains) OR fanout>1 -> Manager
     zero-LLM: no decision-model call by default                          (FR-A6)
  planDispatch({ parent:{role,depth}, child:{role}, policy, headroom, ... }) (FR-B1, FR-B2)
     rejection (illegal_transition | depth_exceeded | parent_not_orchestrator)
        -> explicit typed BLOCK (not silent inheritance)
     ok -> envelope { lineage, fanout, childDepth, executionAllowed, admission }
  model = rolePool[childRole] -> min sorted providerID, non-deprecated      (FR-A4)
     none / Auth.get absent -> undefined (parent inheritance)
  recordDispatch(childSessionId, envelope.lineage)                          (FR-D1)
  orchestration_only ? gate child perms on executionAllowed                 (FR-C1, FR-C2)
  return { childRole, model, executionAllowed } | undefined | block
        |
        v
taskTool.execute(...)  child session created with the decided model + gated perms
```

## Out of Scope

- **A live decision-model LLM consult** for ambiguous classification — Phase 2 stays
  zero-LLM (deterministic analyzer signals only); the consult is a default-off tunable
  deferred to Phase 3 (FR-A6, Clarifications C2).
- **Budget consumption enforcement** (`RoutingSessionState.recordConsumption`,
  turn/worker/token limiters) — the dispatch carries a budget snapshot and the fan-out
  is admission-controlled, but nothing consumes/decrements the budget here (Phase 3).
- **Telemetry surfacing** of the `hierarchy.dispatch` / `escalation` / `validation`
  events onto OTLP spans/metrics (Phase 3).
- **The escalation TRIGGER surface** — this feature specifies the `planEscalation`
  reuse contract and gives it a call site, but the runtime signal that fires an
  escalation (a Worker deciding it needs a Manager) is Phase 3.
- **The operator-stack `InstanceRef` candidate-resolver fix**
  (`operator/stack-live.ts:314/341`) — side-stepped via the session-local composition,
  as in Phase 1 (Phase 3).
- **`always` / `never` mode routing** — only `auto` triggers the hierarchy delegation.

## Clarifications

### Session 2026-07-21

Declarative resolutions for the Feature 042 clarify dimension. Each decision closes an
open marker in the body with a conservative, tunable default and a named acceptance
hook (AC = Acceptance Scenario above), never an open placeholder. This section fixes
the decisions ADR-0042 formalizes; it does not author the ADR.

- **C1 — the Architect classifier threshold (direct-Worker vs Manager path).** The
  resolved DEFAULT is conservative — prefer a **direct Worker** (fewer delegation
  edges, less orchestration overhead, and `orchestration_only` keeps a direct Worker
  fully execution-capable). The Architect escalates to a **Manager** path ONLY when the
  spawn presents **≥ 2 independent work-units spanning ≥ 2 distinct domains, OR a
  requested parallel fan-out > 1** — the case where a coordinating tier genuinely earns
  its edge. These thresholds (work-unit count `2`, domain count `2`, fan-out `1`) are
  read from the Feature 001 task-analyzer signals (FR66) and are TUNABLE plan constants
  with acceptance hook AC "Cross-domain fan-out → Manager path". A Manager parent's
  child is always a Worker (engine legality), so the classifier governs only the
  Architect edge.

- **C2 — the decision-model-call bypass (fast/unambiguous route).** The resolved
  DEFAULT is to **bypass the live decision-model LLM call entirely** in Phase 2: the
  classification runs on the deterministic analyzer signals only (Feature 001 FR17
  fast/unambiguous route), keeping the spawn-routing path zero-LLM, deterministic, and
  hang/crash-safe. A decision-model CONSULT — engaged only when the analyzer's
  ambiguity signal crosses a threshold — is a documented, DEFAULT-OFF tunable deferred
  to Phase 3. The conservative stance is "never consult a model to route a spawn unless
  explicitly enabled," so Phase 2 cannot add latency or a token cost to the spawn path.

- **C3 — depth-walk reconciliation.** When hierarchy routing is active, the
  `HierarchyDispatcher` depth rule (`hierarchy.max_depth`, engine `MAX_DELEGATION_DEPTH`)
  is the authoritative delegation bound; the legacy `tool/task.ts` `subagent_depth`
  guard remains a hard backstop and the effective ceiling is the MINIMUM of the two
  (FR-B3, FR-E3). The legacy error path is preserved unchanged for the
  disabled-hierarchy case.

- **C4 — the Architect model is the main-context selection; the pool is a
  configurable fallback only (FR-A7).** The resolved DECISION: the Architect (the
  primary/root session) ALWAYS uses the MAIN-CONTEXT SELECTED model — the model the
  main context is running as — and the routing engine NEVER overrides it. This
  supersedes the earlier "Architect straight from `role_pools[decision_model.pool[0]]`"
  mapping. `role_pools.architect` (resolved via `decision_model.pool`) is now a
  CONFIGURABLE FALLBACK only, consulted when NO main-context model resolves, then
  `role_pools[fallback.floor_role]`, then the static default. The precedence is
  `explicit --model / agent-pinned ▶ main-context selected ▶ role_pools.architect ▶
  role_pools[floor_role] ▶ static default`. `role_pools.architect` is a first-class,
  generic, configurable role pool (settable exactly like `manager` / `worker` via the
  same `pools.set` mechanism, never special-cased). Manager and Worker resolve from
  their own pools unchanged; explicit and agent-pinned models always win. This also
  reconciles Feature 037 Phase 1: the top-level Architect session keeps the
  main-context/default model, with the pool as the fallback. Acceptance hook AC
  "Architect keeps the main-context model".

## Related Features and Decisions

- [ADR-0042 — Wire per-subagent hierarchy delegation into the Task spawn](../../adr/0042-wire-per-subagent-hierarchy-delegation-into-the-task-spawn.md)
- [Feature 037 — Wire the operator Smart Routing engine into the live session](../037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md) — Phase 1 (the top-level implicit-default model resolver `routing-resolve.ts` this feature mirrors and extends; subagent delegation was its explicit Phase 2).
- [Feature 001 — Define one cohesive Smart Agent Routing and OpenTelemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — the pure `HierarchyDispatcher` engine, the `RoutingSessionState` store, the task-analyzer signals (FR66) and the fast-route bypass (FR17) this feature wires.
- [Feature 007 — Add a unified native operator control plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — the operator control plane and `ConfigPort` authority persistence the routing/hierarchy config lives under.
- [Feature 033 — Add a global authority scope for the pools (role_pools) operator config](../033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md) — the `global:routing` authority that already persists the hierarchy config (`max_depth: 2`, `orchestration_only: true`) this runtime reads and enforces.
