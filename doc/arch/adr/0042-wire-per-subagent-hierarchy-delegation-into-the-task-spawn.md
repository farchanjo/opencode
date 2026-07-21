---
status: proposed
date: 2026-07-21
deciders: [project maintainers]
consulted: []
informed: []
---

# 0042 — Wire Per Subagent Hierarchy Delegation Into The Task Spawn

## Context and Problem Statement

Feature 001 built a complete hierarchical routing model: a pure, unit-tested engine
(`routing/domain/hierarchy-dispatcher.ts` — `planDispatch` / `planEscalation` /
`admitDispatchFanout`) that encodes the Architect → Manager → Worker delegation model
(ADR-0002), plus a session state store (`session/routing-state.ts` `recordDispatch`)
that correlates a parent Session with its dispatched children. Feature 037 Phase 1
wired the routing engine into the TOP-LEVEL implicit-default model of a live session
(`session/routing-resolve.ts`, consumed at `prompt.ts` `createUserMessage` /
`shellImpl`) — but explicitly deferred subagent delegation ("a subagent still inherits
its parent's model", 037 Out of Scope).

The result: the hierarchy engine and the state store are fully implemented and tested
but have ZERO production call sites — `grep` for `HierarchyDispatcher` /
`recordDispatch` returns only the domain file and its test. Meanwhile the Task spawn
seam (`session/prompt.ts:292`) still inherits the parent model verbatim
(`task.model ? getModel(...) : model`), and the hierarchy config is already persisted
in `global:routing` (`max_depth: 2`, `orchestration_only: true`,
`schema/src/routing/config.ts:88-91`) waiting for a runtime that reads and enforces it.

The question: how to give a subagent spawn a FRESH per-spawn hierarchy decision (role
+ delegation depth/path + model) instead of parent-model inheritance — enforcing the
role/depth legality and the `orchestration_only` execution boundary — WITHOUT
overriding an explicit `task.model` or an agent-pinned model, without changing the
default (disabled) behavior at all, without ever crashing or blocking the spawn path,
and without tripping the known operator-stack `InstanceRef` defect. Two design
questions have no prior decision: (1) when should the Architect dispatch a Worker
directly versus route through a Manager, and (2) should a live decision-model LLM be
consulted to make that call.

## Decision Drivers

- **A fresh decision, never inheritance.** A spawn with no explicit model must get a
  per-spawn role + model, not the parent's model copied down.
- **The engine governs the implicit default, never an explicit choice.** An explicit
  `task.model` and an agent-pinned model must ALWAYS win.
- **Role and depth legality are non-negotiable.** Manager may not spawn Manager,
  Worker may not spawn anything, depth ≤ 2 — enforced by the pure engine, not
  re-implemented at the seam.
- **Orchestrators do not execute.** `orchestration_only` must confine project-mutating
  and test-executing authority to a Worker leaf.
- **Zero behavior change by default; never crash or block the spawn path.** The
  disabled default must be byte-for-byte identical to today, and every failure must
  degrade to parent inheritance.
- **Reuse the one engine, one config SSOT, and the Phase 1 safety pattern.** No
  parallel engine, config store, or resolver contract.
- **Give the dead engine exports their first production call sites.**

## Considered Options

### Overall wiring

- **Option A — a session-local hierarchy dispatch resolver mirroring Phase 1, folded
  into the `handleSubtask` seam (chosen).** Add
  `session/routing-hierarchy.ts#createHierarchyDispatchResolver` that composes the pure
  `HierarchyDispatcher` engine and the Feature 001 routing service over the
  session-layer Provider / Config / Agent / Auth interfaces, running every outbound
  seam on the context CAPTURED inside the caller's Effect (`Effect.context()` +
  `Effect.runPromiseWith`) so candidate resolution is `InstanceRef`-bound BY
  CONSTRUCTION — exactly the Feature 037 pattern. The seam (`prompt.ts:292`) consults
  it only in the implicit branch: `task.model ?? agentPinned ?? hierarchyRouted ??
  parentModel`. Reuses the one engine, the one config SSOT, and the Phase 1 provider
  re-resolution / auth / LRU / hang-safety machinery; is a byte-for-byte no-op by
  default.
- **Option B — reach the hierarchy engine through `createLiveOperatorStack`.**
  Rejected: the operator stack's candidate resolvers hit the "InstanceRef not
  provided" defect (`stack-live.ts:314/341`), and coupling the spawn hot path to the
  whole control-plane stack for a read-only role/model choice is unwarranted. The same
  rejection Phase 1 recorded (ADR-0037 Option B).
- **Option C — override the subagent model inside the child's LLM stream.** Rejected:
  the child model is resolved and persisted on the child assistant message before its
  stream begins (`prompt.ts:304-305`); overriding mid-stream would desync the recorded
  message model and entangle routing with streaming/retry. Selection belongs at the
  single spawn seam.

### The Architect classifier threshold (open question 1)

- **Option A1 — direct Worker by default; Manager only on genuine fan-out (chosen).**
  Dispatch a direct Worker unless the spawn presents **≥ 2 independent work-units
  spanning ≥ 2 distinct domains, OR a requested parallel fan-out > 1**, in which case
  dispatch a Manager. Conservative: fewer delegation edges, less orchestration
  overhead, and (with `orchestration_only`) a direct Worker is fully execution-capable,
  so the common single-task spawn stays a leaf. Thresholds (work-units `2`, domains
  `2`, fan-out `1`) are read from the Feature 001 task-analyzer signals (FR66) and are
  TUNABLE plan constants.
- **Option A2 — Manager by default; Worker only for trivial tasks.** Rejected: inserts
  a coordinating tier on the majority of spawns, adding an edge and orchestration
  latency for work that a single Worker handles, and pushes more spawns toward the
  depth limit for no benefit.
- **Option A3 — leave the threshold unspecified / operator-only.** Rejected: the
  feature would ship with no default behavior; a conservative, documented, tunable
  default is required.

### The decision-model call (open question 2)

- **Option B1 — bypass the decision-model LLM call by default; deterministic
  classification only (chosen).** The classification runs entirely on the deterministic
  analyzer signals (Feature 001 FR17 fast/unambiguous route), keeping the spawn-routing
  path zero-LLM, deterministic, and hang/crash-safe. A live decision-model CONSULT —
  engaged only when the analyzer's ambiguity signal crosses a threshold — is a
  documented, DEFAULT-OFF tunable deferred to Phase 3.
- **Option B2 — always consult a decision-model to classify the spawn.** Rejected for
  Phase 2: it adds a live LLM call, latency, and a token cost to every spawn, and a
  slow/failed model call would threaten the "never block the spawn path" contract. The
  conservative stance is "never consult a model to route a spawn unless explicitly
  enabled."

## Decision Outcome

Chosen option: **Option A** (session-local resolver mirroring Phase 1), combined with
**Option A1** (direct-Worker-default classifier) and **Option B1** (decision-model
bypass by default). Composing the pure `HierarchyDispatcher` and the Feature 001 service over the
session-layer interfaces on the captured, `InstanceRef`-bound context lets a spawn get
a fresh role + model — bound by construction, reusing the one engine and config SSOT,
side-stepping the operator `InstanceRef` defect, honoring an explicit/agent model
verbatim, and (via the disabled-default first gate) leaving the spawn seam byte-for-byte
unchanged, with a total non-throwing, hang-proof fallback to parent inheritance.

Key decisions recorded:

1. **Phase 2 wires the delegation dimension of Feature 037.** Phase 1 wired the
   top-level implicit-default model; Phase 2 wires per-subagent hierarchy delegation at
   the spawn seam (a fresh role + depth/path + model, role/depth legality, the
   `orchestration_only` boundary, and `recordDispatch` lineage). A live decision-model
   consult, budget consumption enforcement, telemetry surfacing, the escalation
   trigger, and the operator `InstanceRef` fix are Phase 3.
2. **Session-local composition, bound by construction.**
   `createHierarchyDispatchResolver` composes the pure engine + Feature 001 service
   over the session Provider / Config / Agent / Auth interfaces and runs every seam on
   `Effect.context()` + `Effect.runPromiseWith`; it never touches
   `createLiveOperatorStack`, so `stack-live.ts:314/341` is not reached.
3. **The activation gate is `enabled && mode === "auto"`.** The resolver reads the
   effective config (`routing` > `global:routing` > disabled default) and returns
   `undefined` (→ parent inheritance) unless Smart Routing is explicitly enabled in
   `auto` mode.
4. **Role/depth legality is the pure engine's, enforced via `planDispatch`.** Every
   spawn's parent → child edge is admitted by `planDispatch`; an illegal transition,
   depth over `min(MAX_DELEGATION_DEPTH, hierarchy.max_depth)`, or a non-orchestrator
   dispatch yields a typed `DispatchRejection` that the seam surfaces as an explicit
   blocked spawn — not a silent inheritance. `executionAllowed` is taken from the
   envelope, never recomputed.
5. **`orchestration_only` confines execution to the Worker leaf.** When
   `orchestration_only = true`, an Architect/Manager child spawn is gated (at the
   `tool/task.ts` child-permission derivation) to carry no project-mutating or
   test-executing tool authority; only a Worker child may mutate/test.
6. **The Architect classifier default: direct Worker unless real fan-out (Option
   A1).** Direct Worker unless ≥ 2 independent work-units across ≥ 2 domains OR
   requested fan-out > 1, then Manager. Thresholds are tunable plan constants read from
   the Feature 001 analyzer signals.
7. **The decision-model call is bypassed by default (Option B1).** Classification is
   deterministic and zero-LLM; a consult on high ambiguity is a default-off Phase 3
   tunable.
8. **Deterministic model resolution; unauthenticated providers are refused.** The
   child-role pool model maps to the lexicographically-smallest non-deprecated
   `providerID` (`Provider.list()`), then `Auth.get(providerID)` must be present, else
   `undefined` (parent inheritance) — reusing the Phase 1 machinery.
9. **Lineage correlation and escalation reuse gain call sites.** Every admitted spawn
   calls `RoutingSessionState.recordDispatch(child, lineage)` (no-op on mismatch, never
   throws); a Worker → Manager escalation reuses `planEscalation` (lineage / evidence /
   OutputRefs carried forward). This is the first production consumer of both dead
   exports.
10. **Total, non-throwing, hang-proof fallback + back-compat.** Any failure/defect
    degrades to `undefined`; the whole attempt is raced against `RESOLVE_TIMEOUT_MS`
    (1.5s) and retention is bounded (LRU) — the Feature 037 contract verbatim. With the
    disabled default the resolver short-circuits at the first gate, so
    `task.model ? getModel(...) : (undefined ?? model)` is exactly today's path.
11. **Regression test over the resolver (load-bearing).** A test in
    `packages/opencode/test/session/routing-hierarchy.test.ts` drives the resolver over
    faithful Config / Provider / Agent / Auth fakes and the real engine and asserts the
    disabled default, the fresh child decision, the explicit-model short-circuit, the
    `illegal_transition` / `depth_exceeded` blocks, the `orchestration_only` denial, the
    `recordDispatch` correlation, the unauthenticated-model fallback, and the classifier
    boundary. No existing session/prompt or `tool/task.ts` assertion is weakened.

### Consequences

- Good: when Smart Routing is enabled in `auto` mode with a populated hierarchy config,
  a subagent spawn gets a fresh role + model chosen for the delegation edge — the
  hierarchy engine finally governs the runtime, not just the unit tests.
- Good: an explicit `task.model` and an agent-pinned model are never overridden; the
  change is confined to the implicit default of a spawn.
- Good: the pure engine's role/depth legality and the `orchestration_only` boundary are
  enforced at the spawn, so illegal or runaway delegation cannot be created by a model,
  plugin, or nested instruction; fan-out is admission-controlled.
- Good: the disabled default is a byte-for-byte no-op — shipping this is inert until an
  operator opts in.
- Good: the spawn path can never crash or block on routing — every failure degrades to
  parent inheritance, and selection happens before the child's LLM stream; a legality
  block is a deliberate typed outcome, not a crash.
- Good: `HierarchyDispatcher.planDispatch` / `planEscalation` / `admitDispatchFanout`
  and `RoutingSessionState.recordDispatch` gain their first production call sites.
- Neutral: the classifier is deterministic and zero-LLM by default; a routing decision
  is reproducible but does not yet reflect a decision-model's judgment on ambiguous
  spawns (Phase 3 tunable).
- Residual (Phase 3): a live decision-model consult, budget consumption enforcement
  (`recordConsumption`), telemetry surfacing of the dispatch envelope, the escalation
  trigger surface, the operator-stack `InstanceRef` fix (`stack-live.ts:314/341`), and
  `always`-mode routing are deferred.

## Related

- Feature specification: [042 Wire per-subagent hierarchy delegation into the Task spawn](../sdd/042-wire-per-subagent-hierarchy-delegation-into-the-task-spawn/spec.md)
- Phase 1 (the top-level implicit-default resolver this feature mirrors and extends; subagent delegation was its explicit Phase 2): [037 Wire the operator Smart Routing engine into the live session](../sdd/037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md)
- The pure `HierarchyDispatcher` engine, the `RoutingSessionState` store, the task-analyzer signals (FR66), and the fast-route bypass (FR17) this feature wires: [001 Define one cohesive Smart Agent Routing and OpenTelemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- The hierarchical adaptive routing model (Architect → Manager → Worker, depth ≤ 2, orchestration-only): [ADR-0002 Core Smart Agent Routing](0002-core-smart-agent-routing.md)
- Records the composition, safety, and back-compat contract this feature mirrors: [ADR-0037 Wire the operator Smart Routing engine into the live session](0037-wire-the-operator-smart-routing-engine-into-the-live-session.md)
- The operator control plane and `ConfigPort` authority persistence the routing/hierarchy config lives under: [007 Add a unified native operator control plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- The `global:routing` authority that already persists the hierarchy config (`max_depth: 2`, `orchestration_only: true`): [033 Add a global authority scope for the pools (role_pools) operator config](../sdd/033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md)
