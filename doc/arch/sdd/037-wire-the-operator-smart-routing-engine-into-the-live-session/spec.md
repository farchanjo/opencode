---
id: 019f81e6-74ac-7ae2-bc10-38ad9087f061
number: 037
slug: wire-the-operator-smart-routing-engine-into-the-live-session
status: implemented
created_at: 2026-07-20T23:39:51.852099Z
---
# Feature Specification: Wire The Operator Smart Routing Engine Into The Live Session

Feature: 037-wire-the-operator-smart-routing-engine-into-the-live-session
Created: 2026-07-20
Scope: the live session model-selection seam
(`packages/opencode/src/session/prompt.ts`) and a new session-local resolver
(`packages/opencode/src/session/routing-resolve.ts`) that composes the Feature 001
routing engine (`createRoutingService`) over the session-layer service interfaces
(Provider / Config / Agent / Auth). Feature 001 built the routing engine and its
outbound seams; Features 007/013/014/024 built the operator control plane that
persists a routing config; Features 033/034 made a per-scope routing config
(`routing` / `global:routing`) reachable and operator-configurable. Until now the
engine was reachable ONLY from the operator control plane (`op routing test`,
`smart.status`) — it had ZERO influence on the model a live session actually runs.
This feature closes that gap for the IMPLICIT-DEFAULT model: when Smart Routing is
explicitly enabled in `auto` mode with a populated role pool, the engine chooses
the session's default model; an explicit `--model` and an agent-pinned model always
win, and every other configuration (the disabled-by-default) leaves the static
`currentModel()` path byte-for-byte unchanged.

This work was **explicitly authorized by the user**, lifting the standing CLAUDE.md
guard "Do not implement Smart Routing while alternatives remain open or without
explicit authorization" for this feature (recorded in ADR-0037).

## Phasing

- **Phase 1 (this feature, MVP).** Wire the engine into the implicit-default model
  selection of the live session. The engine chooses the default model per session
  (cached once per session), gated on explicit `auto` activation with a populated
  pool, with a total fallback to the static default on any failure.
- **Phase 2+ (out of scope, noted in ADR-0037).** Per-subagent hierarchy delegation
  at the spawn seam (`tool/task.ts`); budget enforcement (turn/worker/token
  limiters); the operator-stack `InstanceRef` candidate-resolver fix
  (`operator/stack-live.ts:314/341`); telemetry surfacing of the selection.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Smart Routing picks the implicit default model

- As a user who has explicitly enabled Smart Routing in `auto` mode with a populated
  role pool, I want a new session prompt (where I did not pass `--model`) to run the
  model the routing engine selects, so that the routing policy I configured actually
  governs the model the session uses.

### P1 — An explicit or agent-pinned model always wins

- As a user, I want an explicit `--model` (or an agent-pinned model) to ALWAYS be
  honored verbatim, never overridden by routing, so that Smart Routing can only ever
  fill the IMPLICIT default — my explicit choice is authoritative.

### P1 — Disabled Smart Routing changes nothing (back-compat)

- As a maintainer, I want the default configuration (Smart Routing disabled, mode
  `never`, empty role pool) to leave the session model-selection path byte-for-byte
  identical to today, so shipping this feature is a no-op until an operator
  explicitly enables `auto` routing with a real pool.

### P2 — A routed model with no usable provider falls back safely

- As a user, I want the session to fall back to the static default model whenever the
  routed model cannot be mapped to an authenticated provider (or the pool is empty, or
  the engine returns no candidate), so a mis-configured or partially-authenticated
  routing config can never break the prompt path.

### P2 — The model does not flip mid-conversation

- As a user, I want the routing decision for a session to be resolved ONCE and reused
  for every later message in that session, so a long conversation runs on a stable
  model rather than re-routing (and possibly flipping) on each message.

## Functional Requirements

### Group A — the session-local routing resolver (FR-A)

1. **FR-A1 — a session-local routing service, InstanceRef-bound by construction.** A
   new resolver (`session/routing-resolve.ts#createRoutingResolver`) MUST compose
   `createRoutingService` (Feature 001) over the session-layer service INTERFACES
   (Provider / Config / Agent / Auth), running every outbound async seam on the
   context CAPTURED inside the caller's Effect (`Effect.context()` +
   `Effect.runPromiseWith`). Because that context already carries the request
   `InstanceRef` binding, catalog/agent candidate resolution is bound BY
   CONSTRUCTION. The resolver MUST NOT reach into `createLiveOperatorStack` (whose
   catalog/agent seams call `AppRuntime.runPromise` WITHOUT binding `InstanceRef` —
   the "InstanceRef not provided" defect; fixing it is Phase 2).

2. **FR-A2 — the activation gate.** The resolver MUST read the effective routing
   config (project `routing` shadows global `global:routing` shadows the safe
   disabled default, via the Feature 001 `resolveEffective`) and return `undefined`
   unless `activation.enabled === true` AND `activation.mode === "auto"`. This is the
   sole trigger for implicit routing in Phase 1.

3. **FR-A3 — evaluate and take the executor model.** When gated open, the resolver
   MUST call `routingService.evaluate({ sessionId, turnId, taskDescription, taskFingerprint, scope })`
   (a stable content hash of the task text as `taskFingerprint`, `scope: "session"`)
   and take `decision.selection.executor_model` — a bare, provider-less model id.
   `evaluate` persists the decision (Feature 001 durable decision store) as its
   production contract.

4. **FR-A4 — deterministic provider re-resolution.** The resolver MUST map the bare
   model id back to a concrete `providerID` deterministically: the
   lexicographically-smallest `providerID` among the providers that expose the model
   id with a non-deprecated status (from `Provider.list()`). A model id may exist
   under multiple providers; the sorted-providerID rule keeps selection stable and
   reproducible.

5. **FR-A5 — authenticated-provider verification.** The resolver MUST verify the
   re-resolved provider is authenticated via `Auth.get(providerID)`; if it is not
   authenticated (or the lookup errors), the resolver MUST return `undefined` — a
   routed model whose provider has no credential would break the LLM stream, so it
   falls back to the static default.

6. **FR-A6 — record the decision reference.** On a successful resolution the resolver
   MUST record the decision reference (`decisionId` + `catalogVersion` +
   `policyVersion`, with the derived hierarchy role) into the `RoutingSessionState`
   store (Feature 001 `session/routing-state.ts`), correlating the live session with
   its committed decision.

7. **FR-A7 — total, non-throwing fallback.** ANY failure — Smart Routing disabled, an
   empty role pool, no authorized candidate, an unresolved/unauthenticated provider,
   or any evaluate/engine error/defect — MUST degrade to `undefined`. The resolver
   MUST NEVER throw, reject, or block into the prompt path; the whole attempt is
   wrapped so any cause resolves to `undefined`.

### Group B — the per-session drift guard (FR-B)

8. **FR-B — resolve once per session, reuse thereafter.** The resolver MUST cache the
   FIRST resolution per `sessionId` (including a resolved-to-fallback `undefined`) and
   reuse it for every subsequent message in that session, so a long conversation does
   not re-evaluate or flip models mid-stream. The cache lives on the resolver instance
   (one per session-layer construction), not a parallel global store.

### Group C — the session model-selection seam (FR-C)

9. **FR-C1 — inject the routed model only in the implicit-default branch.** The
   session model-selection seam (`prompt.ts` `createUserMessage`, and the shell-path
   mirror in `shellImpl`) MUST consult the resolver ONLY when neither an explicit
   `input.model` NOR an agent-pinned `agent.model` is set, and MUST fold the result
   in strictly between the pinned models and the static default:
   `input.model ?? agent.model ?? routed ?? currentModel()`. An explicit or
   agent-pinned model is NEVER overridden.

10. **FR-C2 — a `undefined` result is the unchanged static path.** When the resolver
    returns `undefined` (the disabled default, or any fallback), the selected model
    MUST be exactly `currentModel()` as today — the session-table model, else the last
    user-message model, else the provider default — with no observable change.

### Group D — back-compat and safety proof (FR-D)

11. **FR-D — proven over the resolver with real services.** Regression coverage MUST
    drive `createRoutingResolver` over faithful service fakes and prove: (a) the
    disabled default returns `undefined`; (b) enabled + `auto` + a populated pool
    returns the pool model's `{ providerID, modelID }`; (c) enabled + `never` returns
    `undefined`; (d) an empty pool returns `undefined`; (e) a routed model with no
    provider auth returns `undefined`; (f) a routed model absent from the live catalog
    returns `undefined`; (g) provider re-resolution is deterministic (smallest
    `providerID` wins); and (h) the first resolution is cached and reused (no second
    evaluation) for a later message in the same session. No existing session/prompt
    assertion is weakened.

## Non-Functional Requirements

- **Zero behavior change by default.** With the disabled-by-default config the
  resolver returns `undefined` at the first gate, so the model-selection seam is
  byte-identical to today — no new provider/model call, no token cost, no latency on
  the default path.
- **The prompt path is never blocked or crashed.** The resolver is fully defensive:
  the routing attempt is wrapped so any error/defect degrades to `undefined`, and it
  is consulted before the LLM stream begins (selection happens in `createUserMessage`
  / `shellImpl`, never inside `llm.stream`).
- **One routing engine, one config SSOT.** The resolver reuses the Feature 001 engine
  and the `routing`/`global:routing` config authorities (via `createConfigAdapter` /
  `resolveEffective`); it introduces no parallel engine, config store, or scope
  mapping.
- **Determinism.** Provider re-resolution and the per-session decision are
  deterministic (sorted `providerID`; cache-once), so a session's model is stable and
  reproducible.

## Security Requirements

- **Data sensitivity/classification.** The resolver reads the routing configuration
  document (operator configuration metadata: activation flags, role pools) and the
  live provider catalog (model ids + status), and it queries `Auth.get(providerID)`
  ONLY for a boolean "is this provider authenticated" decision. It never reads,
  logs, returns, or persists credential material; the `Auth.Info` it receives is used
  solely as a presence check and is not surfaced. The persisted routing decision is
  the Feature 001 redacted record (no secrets).
- **Authentication/authorization.** No new authenticated surface or permission
  boundary. Selecting an unauthenticated provider is explicitly REFUSED (FR-A5),
  narrowing — never widening — what a session may run: routing can only ever pick a
  model whose provider already holds a credential, exactly as an explicit selection
  would require.
- **Input validation.** The untrusted input is the user's task text, which is passed
  ONLY to the Feature 001 deterministic, model-free task analyzer (zero LLM call) and
  hashed into a non-empty `taskFingerprint`; it never reaches a model at selection
  time. The routing config is decoded through the Feature 001 schema (`parseConfig`);
  a malformed document fails the decode and falls back to the safe default.
- **Cryptography in transit/at rest.** Not applicable — the resolver performs no new
  network I/O and persists no new at-rest data beyond the Feature 001 decision record
  (already redacted, written through the existing decision store). It moves no secret.
- **Logging/audit.** No new logging. The decision is committed through the Feature 001
  decision store and correlated in the in-memory `RoutingSessionState`; no config
  payload or credential is written to a log line.
- **Error-handling information exposure.** Every failure path collapses to a plain
  `undefined` (static-default fallback); no stack trace, config fragment, or auth
  detail is surfaced to the prompt path or the user. The resolver cannot fail loudly.

## Acceptance Scenarios

Given the session-local routing resolver composed over the Provider / Config / Agent /
Auth interfaces, with the Feature 001 routing engine and an in-memory decision store

- **Disabled default → unchanged static path (FR-A2, FR-C2, FR-D-a).**
  Given the disabled default routing config (mode `never`, empty pool),
  When the resolver runs for an implicit-default prompt,
  Then it returns `undefined` and the seam selects `currentModel()` exactly as before.

- **Enabled + auto + populated pool → routed model (FR-A3, FR-A4, FR-A5, FR-D-b).**
  Given `routing` is enabled in `auto` mode with `role_pools.worker = ["model-a"]`,
  `model-a` present under an authenticated provider,
  When the resolver runs,
  Then it returns `{ providerID: "anthropic", modelID: "model-a" }` and the
  implicit-default seam uses it.

- **Explicit model set → routing never consulted (FR-C1).**
  Given `input.model` (or `agent.model`) is set,
  When `createUserMessage` selects the model,
  Then the routed branch short-circuits to `undefined` and the explicit/agent model is
  used verbatim.

- **Routed model with no provider auth → fallback (FR-A5, FR-D-e).**
  Given the pool model resolves to a provider with no credential,
  When the resolver runs,
  Then it returns `undefined` and the seam falls back to the static default.

- **Empty pool → fallback (FR-A7, FR-D-d).**
  Given `routing` is enabled + `auto` but the role pool is empty,
  When the resolver runs,
  Then it returns `undefined` (safe fallback).

- **Drift guard (FR-B, FR-D-h).**
  Given a first message resolved a model for a session,
  When a second message with different task text arrives in the same session,
  Then the first resolution is reused without re-evaluating.

## Observability

Phase 1 adds no new metrics, log events, or trace spans. The routing decision is
committed through the Feature 001 decision store and telemetry seam (disabled by
default, signal-gated), unchanged; surfacing the live-session selection as a span/metric
is deferred to Phase 2. The behavioral change is confined to WHICH model an
implicit-default session selects, and only when Smart Routing is explicitly enabled in
`auto` mode. Conventions live in `doc/arch/observability/observability.md`.

## Domain Model

The resolver composes the Feature 001 engine over the session interfaces and folds its
result into the model-selection seam:

```
createUserMessage / shellImpl  (session/prompt.ts)
  routed = (input.model || agent.model) ? undefined
         : resolveRoutingModel({ sessionID, turnID, taskText, scope:"session" })   (FR-C1)
  model  = input.model ?? agent.model ?? routed ?? currentModel()                  (FR-C1, FR-C2)
        |
        v
resolveRoutingModel  (session/routing-resolve.ts)
  drift cache hit? -> reuse first resolution (never re-evaluate)                   (FR-B)
  context = Effect.context()  (carries request InstanceRef)                        (FR-A1)
  resolveEffective()  (routing > global:routing > disabled default)
     not (enabled && mode=="auto") -> undefined                                    (FR-A2)
  createRoutingService(config, candidates[catalog=Provider, agents=Agent],
                       analyzer, decisions).evaluate(...)                          (FR-A3)
     failure / no candidate -> undefined                                          (FR-A7)
  executor_model (bare) -> providerID = min sorted providerID exposing it, non-deprecated (FR-A4)
     none -> undefined
  Auth.get(providerID) absent -> undefined                                        (FR-A5)
  recordDecision(RoutingSessionState)                                             (FR-A6)
  return { providerID, modelID }
        |
        v
llm.stream(...)  UNCHANGED — selection completed before the stream begins
```

## Out of Scope

- **Per-subagent hierarchy delegation** at the spawn seam (`tool/task.ts`) — a
  subagent still inherits its parent's model (Phase 2).
- **Budget enforcement** (turn / worker / token limiters) — the decision carries a
  budget snapshot but nothing consumes/enforces it here (Phase 2).
- **The operator-stack `InstanceRef` candidate-resolver fix**
  (`operator/stack-live.ts:314/341`) — this feature side-steps it via the
  session-local composition; fixing the operator seams is Phase 2.
- **Telemetry surfacing** of the live-session selection as a span/metric (Phase 2).
- **`always` mode / explicit-model routing** — only `auto` triggers the implicit
  default in Phase 1; `always` and `never` do not engage the seam.

## Related Features and Decisions

- [ADR-0037 — Wire the operator Smart Routing engine into the live session](../../adr/0037-wire-the-operator-smart-routing-engine-into-the-live-session.md)
- [Feature 001 — Define one cohesive Smart Agent Routing and OpenTelemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — the routing engine (`createRoutingService`), the outbound config/catalog/agent seams, and the `RoutingSessionState` scaffold this feature composes and consumes.
- [Feature 007 — Add a unified native operator control plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — the operator control plane and the `ConfigPort` authority persistence the routing config lives under.
- [Feature 014 — Complete the operator control-plane persistence and service](../014-complete-the-operator-control-plane-persistence-and-service/spec.md) — the durable config-backed persistence (`store.config`) that holds the routing document.
- [Feature 024 — Implement routing.configure persistence so operator routing config persists](../024-implement-routing-configure-persistence-so-operator-routing/spec.md) — makes the routing config operator-writable, so an operator can populate a role pool to enable this feature.
- [Feature 033 — Add a global authority scope for the pools (role_pools) operator config](../033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md) — the `routing` / `global:routing` scope→authority mapping the effective-config read shadows over.
- [Feature 034 — Add an explicit operator scope selector so global-scoped config is reachable](../034-add-an-explicit-operator-scope-selector-so-global-scoped/spec.md) — makes the global routing config reachable/configurable, feeding the effective config this resolver reads.

## Clarifications

### Session 2026-07-20

- **Explicit authorization lifts the CLAUDE.md Smart-Routing guard (scope).** The user
  explicitly authorized wiring the Smart Routing engine into the live session,
  lifting the standing "no Smart Routing without authorization" guard for this feature.
  Recorded in ADR-0037.
- **Phase 1 wires only the implicit-default model (FR-C1).** Explicit `--model` and
  agent-pinned models always win; routing fills only the implicit default. Hierarchy
  delegation, budget enforcement, the operator `InstanceRef` fix, and telemetry
  surfacing are Phase 2. Recorded in ADR-0037.
- **Session-local composition avoids the operator `InstanceRef` defect (FR-A1).** The
  resolver composes the engine over the session interfaces and runs on the captured,
  InstanceRef-bound context; it does not reach into `createLiveOperatorStack`.
  Recorded in ADR-0037.
- **The gate is `enabled && mode === "auto"` (FR-A2).** Only explicit `auto`
  activation triggers implicit routing; the disabled default and `never` leave the
  static path unchanged. Recorded in ADR-0037.
- **Provider re-resolution is deterministic; unauthenticated providers are refused
  (FR-A4, FR-A5).** The bare executor model maps to the smallest sorted `providerID`
  exposing it non-deprecated, and a provider with no credential falls back to the
  static default. Recorded in ADR-0037.
- **Resolve once per session (FR-B).** The first decision is cached and reused so the
  model never flips mid-conversation. Recorded in ADR-0037.
