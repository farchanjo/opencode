---
id: 019f83b9-3e61-77a0-9c62-1b63a6a0cf34
number: 045
slug: add-always-mode-smart-routing-activation-so-routing-engages
status: implemented
created_at: 2026-07-21T08:09:43.266105Z
---
# Feature Specification: Add Always Mode Smart Routing Activation So Routing Engages

Feature: 045-add-always-mode-smart-routing-activation-so-routing-engages
Created: 2026-07-21
Scope: the live session model-selection seam
(`packages/opencode/src/session/prompt.ts` — `createUserMessage` ~:855 and the
shell path ~:630, where `selected = selectedModel(sessionID)` short-circuits
routing on later turns), the session-local resolvers
(`packages/opencode/src/session/routing-resolve.ts` — the activation gate :372
and the per-session drift cache :421; `routing-hierarchy.ts` — the F042 gate
:369), and the F044 completion gate
(`packages/opencode/src/session/processor.ts` :569). Feature 037 wired the
implicit-default model, Feature 042 wired per-subagent hierarchy delegation, and
Feature 043 wired live budget enforcement — but all three routing/hierarchy
seams engage ONLY under `mode === "auto"` (budget alone already gates on
`mode !== "never"`, F043 `processor.ts:53`). The `"always"` activation value is
already a valid enum (`schemas/routing/config.cue` `#RoutingMode`, the operator
Auto/Always/Never picker `configure-backend.ts:50`) but behaves IDENTICALLY to
`"auto"` — a no-op distinction. This feature gives `"always"` real semantics:
routing RE-EVALUATES on every turn (bypassing the persisted-model short-circuit),
and the hierarchy/orchestration gates admit it as a superset of `"auto"`.

## Problem

Under `mode: "auto"` the routing engine resolves an implicit default model ONCE
per session: on the first turn the session has no model, so routing runs; the
chosen model is persisted onto the first user message, and every later turn's
`selectedModel(sessionID)` returns that persisted model, making `routed`
`undefined` (`prompt.ts` — the `selected` short-circuit) — a deliberate drift
guard (a long conversation never flips models mid-stream, `routing-resolve.ts`
drift cache). The consequence: an operator who changes a role pool, a budget, or
any routing config mid-session sees NO effect until they start a NEW session.
There is no activation level that says "re-evaluate routing every turn". The
`"always"` enum exists for exactly this intent but is inert.

## Auto vs. Always (the formalized distinction)

- **`auto`** — routing engages when the session model is UNSET (the first turn /
  bare default) and SHORT-CIRCUITS on the persisted model for every later turn.
  Hierarchy delegation (F042), budget enforcement (F043), and the orchestration
  gate (F044) engage. A role/pool/config change takes effect only in a NEW
  session.
- **`always`** — routing RE-EVALUATES on EVERY turn, bypassing the msg2+
  persisted-model short-circuit, so a role/pool/config change takes effect on the
  NEXT turn without a new session. `always` is a strict SUPERSET of `auto`'s
  aggressiveness: every subsystem `auto` engages, `always` engages too — plus the
  per-turn re-evaluation.
- **`never` / disabled** — no routing. Byte-identical to no routing at all: no
  re-evaluation, no config read on the persisted-model path, no added latency.

The top invariant holds in BOTH routing modes: an explicit `--model` or an
agent-pinned model ALWAYS wins — routing NEVER overrides an explicit user/agent
model, even under `always`.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — A config change takes effect next turn under always mode

- As an operator, I want `mode: "always"` to re-evaluate routing on every turn so
  that when I change a role pool, a budget, or any routing config mid-session, the
  change takes effect on my NEXT prompt without starting a new session.

### P1 — An explicit model always wins, even under always mode

- As a user, I want an explicit `--model` or an agent-pinned model to ALWAYS win —
  routing must never override it, even under `always` where routing re-evaluates
  every turn — so I keep deterministic control when I pin a model.

### P1 — Disabled/never is byte-identical to no routing

- As a maintainer, I want `never` / disabled to be byte-identical to no routing at
  all: no re-evaluation, no persisted-model-path config read, no added latency, so
  the shipped default is provably a no-op.

### P1 — Always mode is a superset of auto across every routing subsystem

- As an operator, I want `always` to engage hierarchy delegation (F042), budget
  enforcement + fan-out admission (F043), and the orchestration completion gate
  (F044) — everything `auto` engages — so `always` is never a partial or
  inconsistent activation that silently drops a subsystem.

### P1 — The always path is hang/crash-safe

- As a maintainer, I want the per-turn re-evaluation to inherit the Feature 037
  hang/crash-safety contract (bounded resolver, degrade-to-undefined, static
  default fallback) and add NO deadlock or per-turn hang, so always-mode is safe
  under a wedged filesystem or a failing config read.

## Functional Requirements

### Group A — always-mode re-evaluation (FR-A)

1. **FR-A1 — always re-evaluates every turn.** Under `mode: "always"` the session
   model-selection seam MUST consult the routing resolver on EVERY turn, bypassing
   the persisted-model (`selected`) short-circuit that `auto` keeps
   (`prompt.ts` — `shouldConsultRouting({explicitModel, hasPersistedModel, mode})`
   returns `true` when `mode === "always"` even with a persisted model). A role,
   pool, or config change therefore takes effect on the next turn.

2. **FR-A2 — the resolver bypasses its drift cache under always.** The
   session-local resolver (`routing-resolve.ts`) MUST NOT read or write its
   per-session drift cache under `mode: "always"` — it re-evaluates fresh each
   turn. The cache is populated ONLY in `auto` (memoize once per session), so a
   session started in `always` never has a cache entry and a mid-session
   `auto → always` flip cannot serve a stale memoized decision.

3. **FR-A3 — auto still short-circuits.** Under `mode: "auto"` the persisted-model
   short-circuit and the drift-cache memoization MUST remain — a long conversation
   never flips models mid-stream, byte-identical to pre-045.

### Group B — the explicit-model invariant (FR-B)

4. **FR-B1 — an explicit model always wins.** An explicit `--model` (`input.model`)
   or an agent-pinned model (`agent.model`) MUST win over routing in EVERY mode,
   including `always`. When either is present, routing is NOT consulted
   (`shouldConsultRouting` returns `false` for `explicitModel: true` regardless of
   mode); the model precedence is
   `--model / agent-pinned ▶ routing ▶ persisted (selected) ▶ static default`, and
   the explicit head can never be displaced.

### Group C — mode-gate reconciliation across F042/F043/F044 (FR-C)

5. **FR-C1 — routing resolution admits always.** The routing gate
   (`routing-resolve.ts:372`) MUST admit both routing modes —
   `enabled && mode !== "never"` — instead of `mode === "auto"`, so implicit-default
   model resolution engages under `always`.

6. **FR-C2 — hierarchy delegation admits always.** The hierarchy dispatch gate
   (`routing-hierarchy.ts:369`) MUST admit `enabled && mode !== "never"`, so
   per-subagent delegation + fan-out admission (F042) engage under `always`. Each
   Task spawn is keyed by its unique `spawnKey` (fresh per-spawn decision), so
   there is no per-turn memoization to bypass in this seam.

7. **FR-C3 — the orchestration completion gate admits always.** The Manager
   completion gate (`processor.ts:569`) MUST admit `enabled && mode !== "never"`.
   Because FR-C2 makes hierarchy dispatch fire under `always`, the orchestration
   aggregate is now populated under `always`; the completion gate MUST fire too,
   or a Manager could report complete while a foreground delegated Worker is still
   pending. The foreground-enforced / background-informational reconciliation
   (ADR-0044) is preserved unchanged.

8. **FR-C4 — budget enforcement already admits always; keep it.** Budget
   enforcement (`processor.ts:53` `enforcementActive`) already gates on
   `enabled && mode !== "never"`, so it engages under `always` today. This feature
   MUST NOT narrow it; the gates now CONVERGE — routing resolution, hierarchy
   delegation, orchestration, and budget all admit `mode !== "never"`. Any
   remaining `auto`-only heuristic (e.g. the classifier's task-analysis) stays
   internal to a decision and is not a mode gate.

### Group D — back-compat and safety proof (FR-D)

9. **FR-D1 — never/disabled is byte-identical.** With `enabled: false` or
   `mode: "never"`, no routing, hierarchy, orchestration, or per-turn config read
   on the persisted-model path occurs — byte-identical to pre-045. The mode read
   is consulted ONLY when a persisted model would otherwise short-circuit routing
   (msg2+); msg1 and every `auto` turn are unchanged.

10. **FR-D2 — hang/crash-safe always path.** The added mode read
    (`createRoutingActivationReader`) and the per-turn re-evaluation MUST inherit
    the Feature 037 safety contract: the mode read is bounded
    (`Effect.timeout → "never"`) and degrades on any crash/rejection to `"never"`
    (the no-op path); the resolver's `RESOLVE_TIMEOUT_MS` bound and
    degrade-to-`undefined → static default` are unchanged. Always-mode adds NO
    deadlock and NO per-turn hang.

11. **FR-D3 — proven in isolation.** Regression coverage MUST prove, on pure /
    isolatable seams: (a) always re-evaluates every turn (a second turn re-routes,
    unlike auto's short-circuit); (b) auto still short-circuits; (c) an explicit
    model wins under always (`shouldConsultRouting` false for explicit); (d)
    disabled/never is byte-identical (undefined, no route); (e) the reconciled
    F042 gate engages under always; (f) the mode read degrades to `"never"` on a
    dying config read; (g) the always path inherits the hang-safety fallback. No
    existing routing / hierarchy / processor assertion is weakened.

## Non-Functional Requirements

- **Zero behavior change off the always path.** `auto`, `never`, disabled, and
  every first turn are byte-identical to pre-045. Only a persisted-model later
  turn under `always` changes behavior (a re-evaluation), and only there is the
  mode read paid.
- **One config SSOT, one engine.** The feature reuses the `routing` /
  `global:routing` authorities, the pure routing engine, and the existing
  resolvers; it introduces no parallel activation store, mode enum, or config
  source. `"always"` was already a valid enum value.
- **Determinism.** `shouldConsultRouting` is a pure function of
  `(explicitModel, hasPersistedModel, mode)`; the model precedence is a fixed
  `??` chain, so the selection is reproducible from those inputs.
- **The prompt path is never blocked or crashed.** The mode read and the resolver
  are both bounded and degrade to the no-op / static-default path on any failure.

## Security Requirements

- **Data sensitivity/classification.** The feature reads the routing/budget
  configuration document (operator metadata: activation mode, role pools, hard
  maximums) and the session's persisted model reference. It writes NO new data; it
  only changes WHICH model reference an implicit-default turn selects. It reads,
  logs, and persists no message content, credential, or secret.
- **Authentication/authorization.** No new authenticated surface or permission
  boundary. The explicit-model invariant (FR-B1) NARROWS routing's authority — it
  can never override a user/agent model — so always-mode can only ever re-select
  WITHIN the operator-configured, authenticated candidate set the pre-existing
  resolver already gates on (authorized provider + healthy catalog).
- **Input validation.** The untrusted inputs are the routing config (decoded
  through the Feature 001 schema; a malformed activation fails the decode and the
  mode read degrades to `"never"`) and the persisted model reference (already
  validated at persist time). The mode read is bounded and total; a hostile or
  malformed config can only degrade to the no-op path, never widen authority.
- **Cryptography in transit/at rest.** Not applicable — the feature performs no
  new network I/O and persists no new at-rest data. It changes only an in-memory
  model-selection decision.
- **Logging/audit.** No new logging of sensitive material. The activation mode and
  the selected model reference are plain typed values on the existing decision
  record; no config payload or credential is written to a log line.
- **Error-handling information exposure.** A failure in the mode read or the
  resolver collapses to the no-op / static-default path (no stack trace, config
  fragment, or model detail surfaced). The one non-degrading outcome is the
  pre-existing typed hierarchy `blocked` / budget breach, unchanged by this
  feature.

## Acceptance Scenarios

Given the session model-selection seam with the routing resolvers and an effective
routing config

- **Always re-evaluates every turn (FR-A1, FR-A2, FR-D3-a).**
  Given `mode: "always"` and a session that already routed on turn 1,
  When a later turn is prompted after a role-pool change,
  Then the resolver re-evaluates fresh (no drift-cache short-circuit) and the new
  pool takes effect on that turn — no new session required.

- **Auto still short-circuits (FR-A3, FR-D3-b).**
  Given `mode: "auto"` and a session that routed on turn 1,
  When a later turn is prompted,
  Then the resolver serves the memoized first decision and does NOT re-evaluate.

- **Explicit model wins under always (FR-B1, FR-D3-c).**
  Given `mode: "always"` and an explicit `--model` (or agent-pinned model),
  When a turn is prompted,
  Then routing is NOT consulted and the explicit model is used — routing never
  overrides it.

- **Never/disabled byte-identical (FR-D1, FR-D3-d).**
  Given `enabled: false` or `mode: "never"`,
  When any turn is prompted,
  Then no routing runs, no re-evaluation occurs, and the static default / persisted
  model is used exactly as pre-045.

- **Always engages the hierarchy gate (FR-C2, FR-D3-e).**
  Given `mode: "always"` with a populated role pool and a Task spawn,
  When hierarchy dispatch is resolved,
  Then it engages exactly as under `auto` (a routed child role + model), proving
  `always` is a superset.

- **The always path is hang/crash-safe (FR-D2, FR-D3-f/g).**
  Given a dying config read or a stuck decision commit under `mode: "always"`,
  When a turn is prompted,
  Then the mode read degrades to `"never"` and the resolver degrades to `undefined`
  within the timeout — the turn falls back to the static default and never hangs or
  crashes.

## Observability

This feature adds no new metrics, log events, or trace spans. The activation mode
already flows onto the decision record (`routing-service.ts:441`); the behavioral
change is confined to WHEN routing re-evaluates (every turn under `always` vs. once
under `auto`) and WHICH downstream gates admit `always`. Surfacing an
"always-mode re-evaluation" span/counter onto the OTLP seam is deferred. Conventions
live in `doc/arch/observability/observability.md`.

## Domain Model

The activation mode drives one decision at the session model-selection seam and
three downstream gate reconciliations:

```
prompt.ts model-selection seam (createUserMessage ~:855; shell path ~:630)
  explicit   = !!(input.model || agent.model)            // --model / agent-pinned
  selected   = explicit ? undefined : selectedModel(sessionID)   // persisted model
  mode       = (!explicit && selected) ? readRoutingMode() : "auto"  // read ONLY on msg2+
  consult    = shouldConsultRouting({explicit, hasPersisted: !!selected, mode})
                 = !explicit && (!selected || mode === "always")     (FR-A1, FR-B1)
  routed     = consult ? resolveRoutingModel(...) : undefined
  model      = input.model ?? agent.model ?? routed ?? selected ?? currentModel()  (FR-B1)
        |
        v
routing-resolve.ts (the resolver)
  mode = readActivationMode()                                (bounded → "never")  (FR-D2)
  if mode === "never" -> undefined                            (no-op)              (FR-D1)
  memoize = mode === "auto"
  if memoize && driftCache.has -> cached                      (auto short-circuit) (FR-A3)
  resolved = resolveOnce()   (gate :372 now enabled && mode !== "never")           (FR-C1)
  if memoize -> driftCache.set                                (never cache always) (FR-A2)
        |
        v
gate reconciliation (auto → mode !== "never")
  routing-hierarchy.ts:369   enabled && mode !== "never"   -> F042 delegation      (FR-C2)
  processor.ts:569           enabled && mode !== "never"   -> F044 completion gate (FR-C3)
  processor.ts:53            enabled && mode !== "never"   -> F043 budget (kept)    (FR-C4)
```

## Out of Scope

- **A new activation level or enum value** — `"always"` already exists in
  `#RoutingMode`; this feature only gives it behavior. No schema/enum change.
- **The operator status indicator** (`backend-live.ts:107` `auto: mode === "auto"`)
  — the `auto` summary field faithfully reports the mode; re-labeling it to a
  generic "routing active" indicator for always is a status nicety, deferred.
- **Telemetry surfacing** of the always-mode re-evaluation onto OTLP spans/metrics.
- **The operator-stack `InstanceRef` candidate-resolver fix** — side-stepped via the
  session-local composition, as in Features 037 / 042 / 043.

## Clarifications

### Session 2026-07-21

Declarative resolutions for the Feature 045 clarify dimension. Each fixes a decision
ADR-0045 formalizes; it does not author the ADR.

- **C1 — the re-evaluation seam is the persisted-model short-circuit in `prompt.ts`.**
  The real msg2+ short-circuit is `selected = selectedModel(sessionID)` (the
  persisted model), NOT the resolver's drift cache alone. Always-mode bypasses the
  `selected` short-circuit via `shouldConsultRouting`, and the resolver
  additionally bypasses its drift cache. Both layers change so re-evaluation
  actually reaches the engine. Acceptance hook AC "Always re-evaluates every turn".

- **C2 — the explicit-model invariant is the top invariant, in every mode.** An
  explicit `--model` / agent-pinned model wins over routing under `always` exactly
  as under `auto`; `shouldConsultRouting` returns `false` for `explicitModel: true`
  regardless of mode. Acceptance hook AC "Explicit model wins under always".

- **C3 — the mode gates CONVERGE on `mode !== "never"`.** Routing resolution
  (`routing-resolve.ts:372`), hierarchy delegation (`routing-hierarchy.ts:369`),
  and the orchestration completion gate (`processor.ts:569`) move from
  `mode === "auto"` to `mode !== "never"`, joining budget enforcement
  (`processor.ts:53`, already `mode !== "never"`). `always` is thereby a strict
  superset of `auto`, never a partial activation. The rejected alternative
  (make `always` an alias of `auto` at config-decode time) is recorded in
  ADR-0045. Acceptance hook AC "Always engages the hierarchy gate".

- **C4 — the always path is hang/crash-safe.** The mode read is bounded and
  degrades to `"never"`; the resolver's timeout and degrade-to-`undefined` are
  unchanged. No deadlock, no per-turn hang. Acceptance hook AC "The always path is
  hang/crash-safe".

## Related Features and Decisions

- [ADR-0045 — Always-mode Smart Routing activation](../../adr/0045-add-always-mode-smart-routing-activation-so-routing-engages.md)
- [Feature 037 — Wire the operator Smart Routing engine into the live session](../037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md) — Phase 1 (the implicit-default resolver, the drift cache, and the hang/crash-safety contract this feature extends to per-turn re-evaluation).
- [Feature 042 — Wire per-subagent hierarchy delegation into the Task spawn](../042-wire-per-subagent-hierarchy-delegation-into-the-task-spawn/spec.md) — the hierarchy dispatch gate (`routing-hierarchy.ts:369`) this feature reconciles to admit `always`.
- [Feature 043 — Enforce live budget consumption and fan-out admission across the session](../043-enforce-live-budget-consumption-and-fanout-admission-across/spec.md) — established the `mode !== "never"` budget gate the other gates now converge on, and documented the pre-045 divergence this feature closes.
- [Feature 044 — Compose the hierarchy orchestration contract so a Manager](../044-compose-the-hierarchy-orchestration-contract-so-a-manager/spec.md) — the Manager completion gate (`processor.ts:569`) this feature reconciles to admit `always`, preserving the foreground/background reconciliation.
- The activation mode is bound by `doc/arch/schemas/routing/config.cue` (`#RoutingMode: "always" | "auto" | "never"`); the always-mode engagement policy is modeled in `doc/arch/schemas/add-always-mode-smart-routing-activation-so-routing-engages.cue`.
