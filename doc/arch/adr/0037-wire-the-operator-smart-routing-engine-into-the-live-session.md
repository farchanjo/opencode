---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0037 — Wire The Operator Smart Routing Engine Into The Live Session

## Context and Problem Statement

Feature 001 built a complete Smart Routing engine — a deterministic, zero-LLM
pipeline (`createRoutingService`: analyze → classify → resolve candidates → gate →
rank → commit) that turns a task description into a `RoutingDecision` naming a
specialist agent and a concrete `executor_model`. Features 007/013/014/024 built the
operator control plane that persists a routing config under per-scope `ConfigPort`
authorities, and Features 033/034 made a per-scope routing config
(`routing` / `global:routing`) reachable and operator-configurable. But the engine
was reachable ONLY from the operator control plane (`op routing test`,
`smart.status`): it had ZERO influence on the model a live session actually runs. A
user could enable Smart Routing, populate a role pool, and see `smart.status`
report `enabled:true, auto:true` — yet every session still ran the static default
model. The engine was wired to the operator, never to the runtime.

This is also the point where the standing CLAUDE.md guard applies — "Do not implement
Smart Routing while alternatives remain open or without explicit authorization." That
guard was deliberately conservative while the engine matured behind the operator
surface. **The user has now explicitly authorized wiring the engine into the live
session**, lifting the guard for this feature. This ADR records that authorization.

The question: how to let the routing engine choose a live session's DEFAULT model —
without overriding an explicit `--model` or an agent-pinned model, without changing
the default (disabled) behavior at all, without ever crashing or blocking the prompt
path, and without tripping the known operator-stack `InstanceRef` defect.

The `InstanceRef` defect is load-bearing here. The live operator stack's candidate
resolvers (`operator/stack-live.ts:314` catalog, `:341` agent) call
`AppRuntime.runPromise(...)` WITHOUT `Effect.provideService(InstanceRef, instance)` —
unlike the config seam at `:175` which binds it — so reaching Smart Routing THROUGH
`createLiveOperatorStack` fails with "InstanceRef not provided". Any live-session wiring
must not depend on that path.

## Decision Drivers

- **The engine governs the implicit default, never an explicit choice.** An explicit
  `--model` and an agent-pinned model must ALWAYS win; routing may only fill the
  implicit default.
- **Zero behavior change by default.** The disabled-by-default config must leave the
  session model-selection path byte-for-byte identical to today.
- **The prompt path must never crash or block.** Every routing failure — disabled,
  empty pool, no candidate, unresolved/unauthenticated provider, any engine error —
  must degrade silently to the static default.
- **Side-step the operator `InstanceRef` defect.** The wiring must not route through
  `createLiveOperatorStack`; candidate resolution must be `InstanceRef`-bound by
  construction.
- **Reuse the one engine and the one config SSOT.** No parallel routing engine, config
  store, or scope→authority mapping.
- **A stable model per session.** The decision must be resolved once and reused so a
  long conversation does not flip models mid-stream.

## Considered Options

- **Option A — a session-local routing service composed over the session interfaces,
  folded into the model-selection seam (chosen).** Add
  `session/routing-resolve.ts#createRoutingResolver` that composes
  `createRoutingService` over the session-layer Provider / Config / Agent / Auth
  interfaces, running every outbound async seam on the context CAPTURED inside the
  caller's Effect (`Effect.context()` + `Effect.runPromiseWith`). The caller is a
  per-request session Effect that already carries the request `InstanceRef` binding, so
  candidate resolution is bound BY CONSTRUCTION. The seam (`prompt.ts`) consults it only
  in the implicit-default branch: `input.model ?? ag.model ?? routed ?? currentModel()`.
  This reuses the one engine and config SSOT, side-steps the operator defect entirely,
  and — because a disabled config returns `undefined` at the first gate — is a byte-for-byte
  no-op by default.
- **Option B — reach Smart Routing through `createLiveOperatorStack` / the operator
  dispatcher.** Rejected: the operator stack's candidate resolvers hit the "InstanceRef
  not provided" defect (`stack-live.ts:314/341`), and routing a live prompt through the
  operator command dispatcher couples the hot path to the whole control-plane stack
  (audit, Flock, idempotency) for a read-only model choice. Fixing the operator seams is
  worthwhile but is a larger, separable change (Phase 2), and it is not needed to wire
  the session.
- **Option C — override the model inside the LLM stream (`llm.ts`).** Rejected: the model
  is already resolved and persisted on the user/assistant message before the stream
  begins; overriding mid-stream would desync the recorded message model from the model
  actually used, and it would entangle routing with streaming/retry. Selection belongs at
  the single model-selection seam, before the stream.
- **Option D — always route (ignore activation), or route on `always` mode too.**
  Rejected for Phase 1: the trigger is deliberately the narrow `enabled && mode === "auto"`
  gate, so the change is inert until an operator explicitly opts in; `always`-mode
  implicit routing is a deliberate Phase 2 consideration.

## Decision Outcome

Chosen option: **Option A**, because composing the Feature 001 engine over the
session-layer interfaces and running it on the captured, `InstanceRef`-bound context
lets the engine choose the implicit-default model — bound by construction, reusing the
one engine and config SSOT, side-stepping the operator `InstanceRef` defect, honoring an
explicit/agent model verbatim, and (via the disabled-default first gate) leaving the
static path byte-for-byte unchanged, with a total non-throwing fallback.

Key decisions recorded:

1. **Explicit authorization lifts the CLAUDE.md Smart-Routing guard.** The user
   explicitly authorized wiring the engine into the live session; the standing "no Smart
   Routing without authorization" guard is lifted for this feature. This ADR is the
   record of that authorization.
2. **Phase 1 wires only the implicit-default model.** Explicit `--model` and
   agent-pinned models always win; routing fills only the implicit default, resolved
   once per session. Per-subagent hierarchy delegation (`tool/task.ts`), budget
   enforcement, the operator `InstanceRef` fix, and telemetry surfacing are Phase 2.
3. **Session-local composition, bound by construction.**
   `createRoutingResolver` composes `createRoutingService` over the session Provider /
   Config / Agent / Auth interfaces and runs every seam on `Effect.context()` +
   `Effect.runPromiseWith`, which carries the request `InstanceRef`. It never touches
   `createLiveOperatorStack`, so the `stack-live.ts:314/341` defect is not reached.
4. **The activation gate is `enabled && mode === "auto"`.** The resolver reads the
   effective config (`routing` > `global:routing` > disabled default via
   `resolveEffective`) and returns `undefined` unless Smart Routing is explicitly enabled
   in `auto` mode — the sole Phase 1 trigger.
5. **Deterministic provider re-resolution; unauthenticated providers are refused.** The
   bare `decision.selection.executor_model` maps to the lexicographically-smallest
   `providerID` exposing it non-deprecated (`Provider.list()`); the resolver then verifies
   `Auth.get(providerID)` is present, else returns `undefined` — a routed model with no
   provider credential falls back to the static default rather than breaking the stream.
6. **Total, non-throwing fallback + back-compat.** Any failure/defect degrades to
   `undefined`; with the disabled default the resolver short-circuits at the first gate,
   so `input.model ?? ag.model ?? undefined ?? currentModel()` is exactly today's path.
7. **Resolve once per session (drift guard).** The first resolution (including
   resolved-to-fallback) is cached per session and reused, so the model never flips
   mid-conversation.
8. **Regression test over the resolver (load-bearing).** A test in
   `packages/opencode/test/session/routing-resolve.test.ts` drives the resolver over
   faithful Config / Provider / Agent / Auth fakes and the real Feature 001 engine
   (in-memory decision store) and asserts: disabled default → `undefined`; enabled +
   `auto` + populated pool → `{ providerID, modelID }`; enabled + `never` → `undefined`;
   empty pool → `undefined`; no provider auth → `undefined`; absent-from-catalog model →
   `undefined`; provider re-resolution determinism; and the per-session drift cache (no
   second evaluation). No existing session/prompt assertion is weakened.

### Consequences

- Good: when Smart Routing is explicitly enabled in `auto` mode with a populated pool,
  a live session's implicit default model is now chosen by the routing engine — the
  engine finally governs the runtime, not just the operator surface.
- Good: an explicit `--model` and an agent-pinned model are never overridden; the change
  is confined to the implicit default.
- Good: the disabled default is a byte-for-byte no-op — shipping this is inert until an
  operator opts in.
- Good: the wiring side-steps the operator `InstanceRef` defect entirely (session-local,
  bound by construction), so no operator-stack change is needed to ship.
- Good: the prompt path can never crash or block on routing — every failure degrades to
  the static default, and selection happens before the LLM stream.
- Neutral: the resolver reads `Auth.get(providerID)` as a boolean presence check
  (never surfacing credential material) and commits the Feature 001 (redacted) decision
  record through the existing decision store.
- Residual (Phase 2): the operator-stack candidate resolvers remain `InstanceRef`-buggy
  (`stack-live.ts:314/341`); per-subagent hierarchy delegation (`tool/task.ts`), budget
  enforcement, telemetry surfacing, and `always`-mode implicit routing are deferred.
- Residual (Phase 2): committed decision records accumulate under
  `Global.Path.state/routing-decisions` with no pruning. Acceptable by design — ULID-keyed,
  atomic commit — with telemetry-driven retention/pruning deferred to Phase 2.

## Related

- Feature specification: [037 Wire the operator Smart Routing engine into the live session](../sdd/037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md)
- The routing engine, outbound seams, and `RoutingSessionState` scaffold this feature composes/consumes: [001 Define one cohesive Smart Agent Routing and OpenTelemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- The operator control plane and `ConfigPort` authority persistence the routing config lives under: [007 Add a unified native operator control plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- The durable config-backed persistence (`store.config`) that holds the routing document: [014 Complete the operator control-plane persistence and service](../sdd/014-complete-the-operator-control-plane-persistence-and-service/spec.md)
- Makes the routing config operator-writable (populate a role pool to enable this feature): [024 Implement routing.configure persistence so operator routing config persists](../sdd/024-implement-routing-configure-persistence-so-operator-routing/spec.md)
- The `routing` / `global:routing` scope→authority mapping the effective-config read shadows over: [033 Add a global authority scope for the pools (role_pools) operator config](../sdd/033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md)
- Makes the global routing config reachable/configurable, feeding the effective config: [034 Add an explicit operator scope selector so global-scoped config is reachable](../sdd/034-add-an-explicit-operator-scope-selector-so-global-scoped/spec.md)
