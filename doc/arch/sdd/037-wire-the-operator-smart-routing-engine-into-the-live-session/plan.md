# Implementation Plan: Wire The Operator Smart Routing Engine Into The Live Session

## Overview

Wire the Feature 001 Smart Routing engine into the live session so an implicit
default model is chosen by the routing engine when Smart Routing is explicitly
enabled in `auto` mode with a populated role pool. Until now the engine was
reachable only from the operator control plane and had zero influence on the model a
session runs. This plan adds a session-local resolver
(`session/routing-resolve.ts`) that composes `createRoutingService` over the
session-layer Provider / Config / Agent / Auth interfaces — running every outbound
seam on the request-`InstanceRef`-bound context captured inside the caller's Effect,
so candidate resolution is bound BY CONSTRUCTION and the operator stack's
"InstanceRef not provided" defect is side-stepped — and folds its result into the
`prompt.ts` model-selection seam strictly between the pinned models and the static
default. An explicit `--model` and an agent-pinned model always win; the disabled
default leaves the path byte-for-byte unchanged.

Phase 1 (this plan) wires only the implicit-default model. Hierarchy delegation,
budget enforcement, the operator-stack `InstanceRef` fix, and telemetry surfacing are
Phase 2 (ADR-0037).

## Technical Approach

Layers affected (one new file, one seam file, one dependency thread):

- **New resolver (`packages/opencode/src/session/routing-resolve.ts`).**
  `createRoutingResolver(deps)` returns `resolveRoutingModel(input) → Effect<{ providerID, modelID } | undefined>`.
  - **Bound composition (FR-A1).** Inside the returned Effect it captures the caller's
    context (`Effect.context()`) and builds a `run = Effect.runPromiseWith(context)`
    bridge; because the caller (a per-request session Effect) carries the `InstanceRef`
    binding, every `Config`/`Provider`/`Agent`/`Auth` seam runs bound. It never touches
    `createLiveOperatorStack`.
  - **Config seam.** A read-only `ConfigPort` over `Config.get()` / `Config.getGlobal()`
    reads the operator document authority (`operator.authorities["routing"]` /
    `["global:routing"]`), wrapped by the Feature 001 `createConfigAdapter` +
    `toRoutingConfigSource` so `resolveEffective` shadows project > global > disabled
    default.
  - **Gate (FR-A2).** Return `undefined` unless `activation.enabled && activation.mode === "auto"`.
  - **Candidate seams.** `createCatalogAdapter` over a `Provider.list()`-backed
    `CatalogCandidateService` and a `Agent.listSpecialists()`-backed `AgentResolver`
    (the same projection the live operator stack uses), composed via
    `createCandidateSource`; `createTaskAnalyzer()` and an injectable `DecisionStore`
    (durable fs store by default; in-memory in tests) complete `createRoutingService`.
  - **Evaluate + re-resolve (FR-A3, FR-A4).** `evaluate(...)` (persisting the decision)
    yields the bare `decision.selection.executor_model`; provider re-resolution picks
    the lexicographically-smallest `providerID` exposing that model id non-deprecated.
  - **Auth + record + fallback (FR-A5, FR-A6, FR-A7).** Verify `Auth.get(providerID)`
    is present (else `undefined`); record the decision reference into
    `RoutingSessionState`; wrap the whole attempt so any failure/defect degrades to
    `undefined` — never throwing into the prompt path.
  - **Drift cache (FR-B).** A per-resolver `Map<sessionId, ResolvedRoutingModel | null>`
    caches the FIRST resolution (including resolved-to-fallback) and reuses it for
    later messages in the session.
- **Session seam (`packages/opencode/src/session/prompt.ts`).** In `createUserMessage`
  (and the shell-path mirror in `shellImpl`), consult the resolver ONLY in the
  implicit-default branch and fold it between the pinned models and the static default:
  `const routed = (input.model || ag.model) ? undefined : yield* resolveRoutingModel({ sessionID, turnID, taskText, scope: "session" })`,
  then `const model = input.model ?? ag.model ?? routed ?? (yield* currentModel(...))`.
  `taskText` is the prompt's text parts (`input.command` on the shell path); `turnID` is
  `input.messageID ?? input.sessionID`. The resolver is constructed once in the layer
  (`createRoutingResolver({ config, provider, agents, auth })`). (FR-C1, FR-C2)
- **Dependency thread.** `Auth.Service` is resolved in the `SessionPrompt` layer and
  `Auth.node` added to `SessionPrompt.node` deps, so the resolver can verify provider
  authentication. No other wiring changes.

Back-compat (FR-C2, FR-D): with the disabled default the resolver returns `undefined`
at the first gate, so `input.model ?? ag.model ?? undefined ?? currentModel()` is
exactly today's `input.model ?? ag.model ?? currentModel()` — byte-identical.

Testing (FR-D): `packages/opencode/test/session/routing-resolve.test.ts` drives
`createRoutingResolver` over faithful Config / Provider / Agent / Auth fakes and the
real Feature 001 engine (in-memory decision store), proving the gate, end-to-end
selection, the explicit/empty/no-auth/absent-model fallbacks, provider re-resolution
determinism, and the per-session drift cache. Existing `test/session/prompt.test.ts`
and `test/routing/**` assertions are unchanged.

## Companion Artifacts

No companion files are required: this feature introduces no new entity, external
contract, or integration — it composes the existing Feature 001 engine ports over the
session-layer interfaces and folds the result into one seam. The optional
`research.md` / `data-model.md` / `contracts/` / `quickstart.md` are intentionally
omitted (the Domain Model section in `spec.md` carries the flow diagram); the `.feature`
/ `.cue` scaffolds follow the 024–036 convention.
