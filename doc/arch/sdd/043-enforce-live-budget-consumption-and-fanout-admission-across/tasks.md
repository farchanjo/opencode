# Tasks: Enforce Live Budget Consumption And Fanout Admission Across

## Task Breakdown

- [ ] T001 Confirm the seams and the engine surface by reading the code: the
  response-loop seam is `session/processor.ts` `step-finish` (`:435-483`), where
  `usage = Session.getUsage(...)` (`:438`) yields `usage.tokens {input, output,
  reasoning, cache}` (`:445`, `session.ts:370-379`) and `usage.cost` (`:444`); the
  dead sink is `session/routing-state.ts` `recordConsumption` (`:131-133`, zero
  call sites); the pure engine is `routing/domain/budget-policy.ts` (`evaluateBudget`
  `:321`, `checkLimits` `:110`, `checkCost` `:258`, `overMax` `:77`, outcomes
  `ok|blocked|escalation|error` `:49`); the fan-out gate is `routing-hierarchy.ts`
  `buildDispatchRequest` (`:325-328`, full-budget headroom + ZERO per-worker);
  the accounting is `routing-service.ts` (`ZERO_CONSUMPTION` `:95`, admission
  `:293`, `budget_consumed` `:332`); the defaults are `config-adapter.ts`
  `DEFAULT_ROUTING_BUDGET` (`:38-50`). Confirm `grep` for `recordConsumption`
  returns only the state store + its test, and `evaluateBudget` runs only over
  `ZERO_CONSUMPTION`.
- [ ] T002 Add a pure consumption-accumulation helper
  (`session/budget-consume.ts#accumulateConsumption(prior, delta)`): fold a
  per-response `{ turns_used +1, context_tokens_used += usage.tokens.input,
  output_tokens_used += usage.tokens.output, cost { time_ms_used += elapsedMs,
  cost_usd_used += usage.cost } }` delta onto the session's prior
  `Budget.Consumption` (starting from `ZERO_CONSUMPTION`), carrying
  concurrency/retrieval/resilience unchanged. Zero framework deps, testable. (FR-A2)
- [ ] T003 Record real consumption at the response loop
  (`session/processor.ts` `step-finish`, after `:445`): read
  `RoutingSessionState.get(ctx.sessionID).consumption ?? ZERO_CONSUMPTION`, apply
  `accumulateConsumption` over the live `usage`, and call
  `RoutingSessionState.recordConsumption(ctx.sessionID, next)` BEFORE the
  re-evaluation. Thread the state store into the processor layer as Feature 037/042
  thread it. (FR-A1, FR-A3, FR-F2)
- [ ] T004 Re-evaluate the budget mid-session: after recording, call
  `evaluateBudget(effectiveBudget, next)` (the first non-`ZERO_CONSUMPTION` call
  site) and, on `outcome !== "ok"`, surface the typed `blocked` / `escalation` /
  `error` with its `Violation[]` (mirroring `routing-service.ts:294-299`). NEVER
  truncate, cap, or reduce the recorded value to fit. Read the effective budget via
  the same `resolveEffective` the resolvers use. (FR-B1, FR-B2, FR-B3)
- [ ] T005 Feed real headroom into fan-out admission
  (`routing-hierarchy.ts` `buildDispatchRequest`, `:325`, `:328`): compute
  `headroom = { costUsd: max(0, cost_budget_usd - consumed.cost_usd_used),
  tokens: max(0, token_budget - (context_tokens_used + output_tokens_used)) }` from
  `RoutingSessionState.get(parentSessionId).consumption`, and supply a non-zero,
  tunable `perWorker` plan constant so cost/token headroom genuinely bounds the
  granted worker count. Take the granted count / `admission_denied` from the
  envelope, never recompute; keep the legacy depth backstop. (FR-C1, FR-C2, FR-C3)
- [ ] T006 Reflect real consumption in the accounting
  (`routing-service.ts:332`): set `accounting.budget_consumed` from the session's
  recorded consumption (`RoutingSessionState.get`) instead of `ZERO_CONSUMPTION`;
  keep the pre-execution zero admission at `:293` unchanged. (FR-D1, FR-D2)
- [ ] T007 Reconcile the out-of-box defaults (`config-adapter.ts`
  `DEFAULT_ROUTING_BUDGET`, `:38-50`) with the ADR-0043 defaults table grounded in
  the `global:routing` values (`max_turns` 8, `max_workers` 3, `max_context_tokens`
  200000, `max_output_tokens` 8000, `token_budget` 800000, `max_delegation_depth`
  2), so enforcement is active out-of-box; verify the defaults apply ONLY when the
  effective origin is `default` and an explicit operator budget overrides them
  verbatim. (FR-E1, FR-E2)
- [ ] T008 Make the budget path total and hang/crash-safe: wrap consumption
  recording and the mid-session re-evaluation so any error/defect degrades to a
  no-op and the turn never crashes or blocks; fan-out admission failure degrades to
  the Feature 042 behavior. A `blocked` / `escalation` / `error` breach survives the
  wrap as a deliberate typed value. (FR-F1)
- [ ] T009 Add the regression (`test/session/budget-consume.test.ts`) over the real
  engine + state store: real consumption recorded; accumulation across turns;
  `max_turns` / `max_context_tokens` / `max_output_tokens` breach → explicit
  `blocked` (never truncated); `admitDispatchFanout` grants fewer workers as
  headroom shrinks; `budget_consumed` reflects real consumption; default budget
  enforced when no operator config, explicit operator budget overrides; an injected
  error degrades to a no-op. No existing session/processor, routing, or
  `tool/task.ts` assertion is weakened. (FR-F3)
- [ ] T010 Author the speckit corpus (`spec.md`, `plan.md`, `tasks.md`) and
  `adr/0043-enforce-live-budget-consumption-and-fanout-admission-across.md`
  (recording the Phase 2b enforcement decision AND the budget-defaults decision —
  no-defaults vs sensible-defaults, sensible-defaults chosen with the numeric table
  — and the hang/crash-safety and back-compat guarantees), extend the guard scope
  for the new source/test paths, and leave the gates green (`bun test test/session/
  test/routing/ test/tool/`, `bunx tsgo --noEmit`, `speckit validate`, `speckit
  analyze`).

## Dependencies

- Feature 037 (Phase 1: the top-level resolver, the `RoutingSessionState`
  threading, and the hang/crash-safety contract) — mirrored here; already shipped.
- Feature 042 (Phase 2a: the `admitDispatchFanout` gate in `routing-hierarchy.ts`
  this feature feeds with real headroom, and the depth-backstop reconciliation) —
  extended here; already shipped.
- Feature 001 (the pure `budget-policy.ts` engine, the `Budget.Consumption` value
  object, the `RoutingSessionState` store, and the `ZERO_CONSUMPTION` admission) —
  wired and consumed here; already shipped.
- Feature 007 / 014 (the operator control plane + durable `ConfigPort`
  persistence) — the routing/budget config lives under these authorities; already
  shipped.
- Feature 033 / 034 (the `routing` / `global:routing` scope→authority mapping) —
  the `global:routing` authority that persists the budget values the defaults are
  grounded in; already shipped.

## Residuals (deferred to Phase 3)

- Retrieval-dimension live consumption (`retrieval_chunks_used` /
  `rerank_chunks_used` / `skill_*` counts from Feature 006).
- Resilience-dimension live counts (`retry_count` / `validation_count` from the
  fallback state machine).
- Telemetry surfacing of the budget-breach outcome (`budget.blocked` /
  `budget.escalation`) onto OTLP spans/metrics.
- The operator-stack `InstanceRef` candidate-resolver fix (`operator/stack-live.ts:314/341`).
- `always` / `never`-mode fan-out routing (admission engages only under active
  `auto` hierarchy routing; the hard-maximum re-evaluation is unconditional).
