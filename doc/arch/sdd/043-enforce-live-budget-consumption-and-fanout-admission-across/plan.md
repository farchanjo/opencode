# Implementation Plan: Enforce Live Budget Consumption And Fanout Admission Across

## Overview

Feature 037 Phase 1 wired the routing engine into the top-level implicit-default
model; Feature 042 Phase 2a wired per-subagent hierarchy delegation into the Task
spawn seam. Both carried a `Budget.PolicySnapshot` but nothing consumed or
enforced it: the pure budget engine (`routing/domain/budget-policy.ts`) runs
exactly ONCE per decision as a ZERO-consumption sanity check
(`routing-service.ts:293`), `decision.accounting.budget_consumed` persists the
ZERO snapshot (`routing-service.ts:332`), and `RoutingSessionState.recordConsumption`
(`session/routing-state.ts:131-133`) is dead code.

This plan wires the budget engine into the runtime: record REAL per-turn /
per-token consumption at the `processor.ts` response loop, re-evaluate the budget
mid-session against the accumulated consumption (emitting an explicit
`blocked` / `escalation` / `error` — never a silent truncation), feed real cost /
token headroom into the Feature 042 fan-out admission gate, reflect real
consumption in the persisted accounting, and make enforcement ACTIVE out-of-box
via a sensible default budget. The whole path mirrors the Feature 037 / 042
hang/crash-safety contract: a failure degrades to a no-op and never crashes or
blocks the turn, while a genuine breach is a deliberate typed outcome.

Phase 2b (this plan) records the throughput and cost dimensions and enforces the
hard maximums; retrieval/resilience live consumption, telemetry surfacing, and the
operator `InstanceRef` fix are Phase 3 (ADR-0043).

## Confirmed seams (file:line)

- **The response-loop seam — where real usage is known.**
  `packages/opencode/src/session/processor.ts` `step-finish` (`:435-483`). The
  live usage is `usage = Session.getUsage({ model, usage: value.usage, metadata })`
  (`:438-442`); `ctx.assistantMessage.cost += usage.cost` (`:444`),
  `ctx.assistantMessage.tokens = usage.tokens` (`:445`). `usage.tokens` is
  `{ total, input, output, reasoning, cache: { read, write } }`
  (`session.ts:370-379`); `getUsage` (`session.ts:338-390`) clamps non-finite /
  negative values to safe non-negative counts (`safe`, `:339-341`), and
  `contextTokens = inputTokens` (`:381`). This is the ONE place per completed step
  where real token/turn/cost spend is available before the next turn begins.
- **The dead consumption sink — the code to call.**
  `packages/opencode/src/session/routing-state.ts` —
  `recordConsumption(sessionId, consumption): RoutingSessionState` (`:97`,
  `:131-133`, currently `put({ ...current, consumption })` with ZERO call sites),
  `get(sessionId)` (`:87`, `:104-106`), the `consumption: Budget.Consumption | null`
  field (`:42`) that starts `null` (`empty`, `:45-47`).
- **The pure engine — what this feature calls with real consumption.**
  `packages/opencode/src/routing/domain/budget-policy.ts`:
  - `evaluateBudget(policy, consumption, input?): Decision` (`:321-332`) —
    aggregates `checkLimits` + `checkRetrievalConsumption` + `checkCost` +
    `checkResilience` (plus optional `admitFanout` / `checkDelegationDepth` /
    `admitRetrieval`); returns the most severe `Outcome` with every `Violation`
    preserved.
  - `checkLimits(policy, consumption, bytes?)` (`:110-139`) — `max_turns`,
    `max_context_tokens`, `max_output_tokens` (+ optional bytes) → `blocked`.
  - `checkCost(policy, consumption)` (`:258-267`) — `time_budget_ms`,
    `cost_budget_usd`, `token_budget` (tokens = context + output) → `blocked`.
  - `checkResilience` (`:280-301`) → `escalation`; `overMax` (`:77-89`) yields
    `error` on a non-finite limit/observed, never a truncated value.
  - The `Outcome` vocabulary `ok | blocked | escalation | error` (`:49-50`); the
    hard-maximum invariant is stated in the file header (`:1-29`): "may never be
    relaxed by a model, plugin, MCP call or nested instruction".
- **The fan-out admission gate — what this feature feeds real headroom.**
  `packages/opencode/src/session/routing-hierarchy.ts` `buildDispatchRequest`
  (`:305-330`), specifically `headroom: { costUsd: budget.cost.cost_budget_usd,
  tokens: budget.cost.token_budget }` (`:325`) and `perWorker: { costUsd: 0,
  tokens: 0 }` (`:328`) — Feature 042 passes the FULL budget as headroom and a
  ZERO per-worker estimate, so `admitDispatchFanout` is bounded by `max_workers`
  alone. The engine is
  `HierarchyDispatcher.admitDispatchFanout(policy, requested, headroom, perWorker)`
  (`hierarchy-dispatcher.ts:101-124`): `granted = min(admitFanout(policy,
  requested).granted, headroomWorkers(costUsd/perWorker), headroomWorkers(tokens/
  perWorker))`, folded into `planDispatch` at `hierarchy-dispatcher.ts:206`.
- **The accounting sink — the ZERO to replace.**
  `packages/opencode/src/routing/application/routing-service.ts` — the
  `ZERO_CONSUMPTION` literal (`:95-101`), the pre-execution admission
  `evaluateBudget(config.enforcement.budget, ZERO_CONSUMPTION)` (`:293`, KEPT),
  and `accounting.budget_consumed: ZERO_CONSUMPTION` (`:330-332`, the field to
  reflect real consumption).
- **The legacy nesting backstop.** `packages/opencode/src/tool/task.ts` the
  parent-chain depth walk (`:178-193`) with `reconcileDepthCeiling(legacyCeiling,
  hierarchyMaxDepth)` (`:85-87`) — retained as the depth backstop under FR-C2.
- **The defaults application point.**
  `packages/opencode/src/routing/adapters/outbound/config-adapter.ts`
  `DEFAULT_ROUTING_BUDGET` (`:38-50`), applied by the effective-config resolution
  when the origin is `default` (`DEFAULT_ROUTING_CONFIG`, `:56-68`). The persisted
  `global:routing` operator document holds the tighter grounded values (`max_turns`
  8, `max_workers` 3, `token_budget` 800000).
- **The config + consumption shapes.** `packages/schema/src/routing/budget.ts`
  `Policy` (`:66-72`) and `Consumption` (`:137-143`) — `ConsumptionThroughput`
  (`turns_used`, `context_tokens_used`, `output_tokens_used`, optional bytes,
  `:94-100`) and `ConsumptionCost` (`time_ms_used`, `cost_usd_used`, `:122-125`).
  `RoutingEnforcement.budget: Budget.Policy` (`config.ts:87`). The value object is
  bound by `doc/arch/schemas/routing/budget-consumption.cue`.

## Technical Approach

Layers affected: one response-loop edit, one admission-input edit, one accounting
edit, plus a small consumption-accumulation helper — all reusing the existing
engine and state store.

- **Consumption recording at the response loop (FR-A1, FR-A2, FR-A3).** In
  `processor.ts` `step-finish` (after `:445`, where `usage` is resolved), map the
  live usage to a `Budget.Consumption` delta and ACCUMULATE it onto the session's
  prior recorded consumption:
  - `prior = RoutingSessionState.get(ctx.sessionID).consumption ?? ZERO_CONSUMPTION`.
  - `next.throughput = { turns_used: prior.turns_used + 1,
    context_tokens_used: prior.context_tokens_used + usage.tokens.input,
    output_tokens_used: prior.output_tokens_used + usage.tokens.output }`.
  - `next.cost = { time_ms_used: prior.time_ms_used + elapsedMs,
    cost_usd_used: prior.cost_usd_used + usage.cost }`; concurrency / retrieval /
    resilience carry the prior values unchanged (Phase 3 fills them).
  - `RoutingSessionState.recordConsumption(ctx.sessionID, next)`.
  A small pure helper `accumulateConsumption(prior, delta)` (co-located with the
  state store or a `session/budget-consume.ts` module) keeps the arithmetic
  testable and the seam thin. Recording happens BEFORE the re-evaluation reads it
  (FR-A3). The store is threaded into the `processor` layer the same way Feature
  037 / 042 thread `RoutingSessionState` into `prompt.ts`.
- **Mid-session re-evaluation (FR-B1, FR-B2, FR-B3).** Immediately after
  recording, call `evaluateBudget(effectiveBudget, next)` — the first
  non-`ZERO_CONSUMPTION` call site. On `outcome !== "ok"` surface the typed outcome
  and its `Violation[]` (a `blocked` / `escalation` / `error`), mirroring the
  existing error surfacing path in `routing-service.ts:294-299`. The runtime NEVER
  truncates, caps, or reduces `usage.tokens` to fit — the recorded value is the
  real spend and the breach is reported. The effective budget is read from the same
  `resolveEffective` the resolvers use (project `routing` > `global:routing` >
  default); Phase 2b keeps this a zero-LLM, pure evaluation.
- **Fan-out admission against real headroom (FR-C1, FR-C2, FR-C3).** In
  `routing-hierarchy.ts` `buildDispatchRequest`, replace the full-budget headroom
  and ZERO per-worker estimate (`:325`, `:328`) with:
  - `consumed = RoutingSessionState.get(parentSessionId).consumption ?? ZERO`.
  - `headroom = { costUsd: max(0, budget.cost.cost_budget_usd - consumed.cost.cost_usd_used),
    tokens: max(0, budget.cost.token_budget - (consumed.throughput.context_tokens_used
    + consumed.throughput.output_tokens_used)) }`.
  - `perWorker = { costUsd: PER_WORKER_COST_USD, tokens: PER_WORKER_TOKENS }` — a
    non-zero, tunable plan constant so cost/token headroom genuinely bounds the
    granted worker count (a conservative estimate of one worker's spend).
  `admitDispatchFanout` then grants `min(requested, max_workers, cost headroom,
  token headroom)`. The granted count and `admission_denied` outcome are taken from
  the `planDispatch` envelope, never recomputed (FR-C3). The legacy subagent-depth
  walk (`tool/task.ts:178-193`) and `reconcileDepthCeiling` remain as the depth
  backstop (FR-C2).
- **Real accounting (FR-D1, FR-D2).** `decision.accounting.budget_consumed`
  (`routing-service.ts:332`) is set from the session's recorded consumption instead
  of `ZERO_CONSUMPTION`. Because `evaluate` runs at decision time (which may precede
  meaningful spend), the accounting reflects the consumption recorded up to that
  decision (the running total from `RoutingSessionState.get`); the pre-execution
  zero admission at `:293` is UNCHANGED (it is the policy sanity check, FR-D2).
- **Defaults (FR-E1, FR-E2).** No new defaults source: the existing
  `DEFAULT_ROUTING_BUDGET` (`config-adapter.ts:38-50`) is already applied when the
  effective origin is `default`. This plan RECONCILES its numbers with the
  ADR-0043 defaults table (grounded in the `global:routing` values `max_turns` 8,
  `max_workers` 3, `token_budget` 800000, `max_context_tokens` 200000,
  `max_output_tokens` 8000, `max_delegation_depth` 2), so the out-of-box floor
  matches the documented decision. An explicit operator budget at either scope
  overrides it verbatim (origin `project` / `global` shadows `default`).

Back-compat (FR-F): a within-budget session records consumption and re-evaluates
to `ok`, so there is no observable change to output; only a genuine breach changes
behavior. With recording wrapped as a best-effort side effect, a within-budget
turn behaves byte-identically to today apart from the (invisible) recorded counts.

## Test strategy (FR-F3)

`packages/opencode/test/session/budget-consume.test.ts` (and the existing
`test/routing/**` engine tests) prove, over the real `budget-policy.ts` engine and
the `RoutingSessionState` store with faithful usage shapes:
(a) a completed response records real turn/token/cost consumption; (b) consumption
accumulates across turns (not overwrites); (c) a `max_turns` / `max_context_tokens`
/ `max_output_tokens` breach yields the explicit `blocked` outcome with the
`Violation`, never a truncated value; (d) `admitDispatchFanout` grants fewer
workers as cost/token headroom shrinks (and `max_workers` alone when headroom is
ample); (e) `budget_consumed` reflects the recorded consumption, not
`ZERO_CONSUMPTION`; (f) the default budget is enforced when no operator config is
present and an explicit operator budget overrides it; (g) an injected error in the
recording/re-evaluation path degrades to a no-op and the turn proceeds. Existing
`test/session/processor.*`, `test/routing/**`, and `test/tool/task.test.ts`
assertions are unchanged.

## Hang / crash-safety contract

Restated from Feature 037 / 042: the budget path can NEVER crash OR block the
turn. Consumption recording and the mid-session re-evaluation are wrapped so any
error/defect (a malformed usage, a store failure, a non-finite policy) degrades to
a no-op — recording is a best-effort side effect, and a broken re-evaluation
resolves as if `ok`. Fan-out admission failure degrades to the Feature 042
behavior (parent inheritance / `max_workers`-only). Selection and enforcement
complete BETWEEN turns (at `step-finish` and at the spawn seam), never inside the
LLM stream. The ONE non-degrading outcome is a genuine budget BREACH
(`blocked` / `escalation` / `error`): a deliberate, typed value the runtime
surfaces honestly — it is not a crash and never leaks a secret or message content.
No hard maximum is ever silently truncated, capped, or relaxed by any instruction.

## Companion Artifacts

No companion files are required: this feature introduces no new entity, external
contract, or integration — it wires the existing pure `budget-policy.ts` engine,
the `RoutingSessionState` store, and the `admitDispatchFanout` gate into the
runtime and folds the result into three seams. The optional `research.md` /
`data-model.md` / `contracts/` / `quickstart.md` are intentionally omitted (the
Domain Model section in `spec.md` carries the flow diagram; the recorded
`Budget.Consumption` value object is bound by
`doc/arch/schemas/routing/budget-consumption.cue`); the `.feature` / `.cue`
scaffolds follow the 024-042 convention.
