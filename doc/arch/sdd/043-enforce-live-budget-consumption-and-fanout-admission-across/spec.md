---
id: 019f8320-243b-7893-a2ba-f0963837a622
number: 043
slug: enforce-live-budget-consumption-and-fanout-admission-across
status: specified
created_at: 2026-07-21T05:22:29.563153Z
---
# Feature Specification: Enforce Live Budget Consumption And Fanout Admission Across

Feature: 043-enforce-live-budget-consumption-and-fanout-admission-across
Created: 2026-07-21
Scope: the live session response loop
(`packages/opencode/src/session/processor.ts` `step-finish`, ~:435-483, where the
real per-response LLM usage is known at `Session.getUsage(...)` :438 →
`usage.tokens` :445 / `usage.cost` :444) and the Task fan-out admission seam
(`packages/opencode/src/session/routing-hierarchy.ts` :325-328, the `headroom` /
`perWorker` inputs to `HierarchyDispatcher.admitDispatchFanout`), wiring the
pure-domain budget engine (`packages/opencode/src/routing/domain/budget-policy.ts`
— `checkLimits` :110, `admitFanout` :156, `evaluateBudget` :321) and the dead
`session/routing-state.ts` `recordConsumption` (:97, :131-133) into the runtime.
Feature 037 Phase 1 wired the top-level implicit-default model; Feature 042
Phase 2 wired per-subagent hierarchy delegation; both carried a budget SNAPSHOT
but nothing consumed or enforced it. Today the budget engine runs exactly ONCE
per decision, as a one-shot ZERO-consumption sanity check
(`routing-service.ts:293` `evaluateBudget(config.enforcement.budget,
ZERO_CONSUMPTION)`), and `decision.accounting.budget_consumed`
(`routing-service.ts:332`) persists the ZERO snapshot; `recordConsumption` has
ZERO production call sites. This feature is Feature 037 **Phase 2 for the budget
dimension**: record REAL per-turn / per-token consumption from live LLM
responses, re-evaluate the budget mid-session, admit fan-out against real cost
and token headroom, and reflect real consumption in the persisted accounting —
so a hard maximum a model may never relax (`budget-policy.ts` header) is enforced
at runtime, not just unit-tested.

The pure budget engine is fully unit-tested but has ZERO runtime call sites for
consumption enforcement: `grep` for `recordConsumption` returns only the state
store and its test, and `evaluateBudget` runs only over `ZERO_CONSUMPTION`. This
feature is the wiring that gives them their first real consumers. The
`Budget.Consumption` value object it records is bound by
`doc/arch/schemas/routing/budget-consumption.cue` (the `#BudgetConsumption`
composition over throughput / concurrency / retrieval / cost / resilience).

## Phasing

- **Phase 1 (Feature 037, shipped).** Wire the routing engine into the top-level
  implicit-default model of a live session (`routing-resolve.ts`). Budget
  enforcement was explicitly out of scope ("the decision carries a budget
  snapshot but nothing consumes/enforces it here").
- **Phase 2a (Feature 042, shipped).** Wire per-subagent hierarchy delegation
  into the Task spawn seam. Fan-out was admission-controlled through
  `admitDispatchFanout`, but with a ZERO per-worker estimate and un-decremented
  headroom (`routing-hierarchy.ts:325-328`), so `max_workers` was the only live
  factor; budget CONSUMPTION enforcement was explicitly deferred.
- **Phase 2b (this feature).** Record real per-turn / per-token consumption,
  re-evaluate the budget mid-session, feed real cost/token headroom into fan-out
  admission, and persist real accounting — the budget dimension of Feature 037
  Phase 2. Enforcement is ACTIVE out-of-box via sensible defaults.
- **Phase 3+ (out of scope, noted in ADR-0043).** Retrieval-dimension live
  consumption (Feature 006 chunk counts), resilience-dimension live counts
  (retry/validation), telemetry surfacing of the budget-breach outcome as a
  span/metric, and the operator-stack `InstanceRef` candidate-resolver fix.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Real consumption is recorded from live LLM responses

- As a maintainer, I want each completed LLM response's real turn and token spend
  recorded into `RoutingSessionState.recordConsumption` (turns_used /
  context_tokens_used / output_tokens_used), so the budget engine evaluates
  against what the session actually spent — not a dead zero snapshot.

### P1 — A hard maximum breach is an explicit typed outcome, never silent truncation

- As a maintainer, I want a mid-session budget re-evaluation to emit an EXPLICIT
  `blocked` | `escalation` | `error` outcome when `max_turns`,
  `max_context_tokens`, or `max_output_tokens` is exceeded, never a silently
  truncated or reduced value, so a model, plugin, MCP call, or nested instruction
  can NEVER relax a hard maximum by talking its way past it.

### P1 — Fan-out admission honors real cost and token headroom

- As a user who has enabled Smart Routing in `auto` mode, I want every Task spawn
  to pass `admitDispatchFanout` with `max_workers` AND the real remaining cost /
  token headroom (budget minus recorded consumption), in addition to the legacy
  subagent-depth nesting check, so a runaway or hostile fan-out cannot spawn an
  unbounded worker set once the budget is nearly spent.

### P1 — Accounting reflects real consumption, not the zero snapshot

- As a maintainer, I want `decision.accounting.budget_consumed` to carry the
  post-execution consumption instead of the persisted `ZERO_CONSUMPTION`, so the
  durable decision record honestly reflects what the turn spent for replay and
  audit.

### P1 — Enforcement is active out-of-box (sensible defaults)

- As an operator, I want a sensible, documented, out-of-box budget to be enforced
  even when I have set nothing, so budget enforcement is ACTIVE by default rather
  than dormant until I configure every numeric limit — while any explicit budget
  I set always wins.

### P1 — The budget path is hang/crash-safe

- As a maintainer, I want a failure anywhere in the budget path to degrade safely
  and never crash or block the turn (mirroring Feature 037 / 042), while a genuine
  budget breach is surfaced honestly as a deliberate typed outcome — so
  enforcement is both safe and truthful.

## Functional Requirements

### Group A — live consumption recording (FR-A)

1. **FR-A1 — record real per-response consumption.** On each completed LLM
   response the runtime MUST record the real observed spend into
   `RoutingSessionState.recordConsumption(sessionId, consumption)` — the
   `Budget.Consumption` throughput dimension (`turns_used`,
   `context_tokens_used`, `output_tokens_used`) derived from the live
   `Session.getUsage(...)` result at the `processor.ts` `step-finish` seam
   (`usage.tokens.input` → context tokens, `usage.tokens.output` → output
   tokens, one completed step → one turn), and the `cost` dimension
   (`time_ms_used`, `cost_usd_used` from `usage.cost`). `recordConsumption` is no
   longer dead code.

2. **FR-A2 — accumulate, never overwrite.** Consumption MUST ACCUMULATE across a
   session's turns: each `step-finish` ADDS its turn (`+1`) and its token/cost
   spend onto the session's prior `RoutingSessionState.get(sessionId).consumption`
   (starting from `ZERO_CONSUMPTION`), so a long conversation's recorded spend is
   the running total, not the last step alone.

3. **FR-A3 — record before enforcement.** The recording MUST happen before the
   mid-session re-evaluation reads it (FR-B), so a breach is detected against the
   consumption that includes the step just completed.

### Group B — mid-session budget re-evaluation (FR-B)

4. **FR-B1 — re-evaluate against real consumption.** After recording, the runtime
   MUST re-run `evaluateBudget(config.enforcement.budget, recordedConsumption)`
   (the pure engine, `budget-policy.ts:321`) against the accumulated consumption
   — NOT `ZERO_CONSUMPTION`. This is the first non-zero call site of the engine.

5. **FR-B2 — an exceeded hard maximum is an explicit typed outcome.** When
   `max_turns`, `max_context_tokens`, or `max_output_tokens` is exceeded
   (`checkLimits`, `budget-policy.ts:110`), the re-evaluation MUST surface the
   engine's explicit outcome — `blocked` for a limits/cost breach, `escalation`
   for a resilience threshold, `error` for a non-finite/mis-specified policy —
   with every individual `Violation` preserved. The runtime MUST NEVER silently
   truncate, cap, or reduce the value to fit; the breach is reported honestly.

6. **FR-B3 — a hard maximum can never be relaxed by an instruction.** No model
   output, plugin, MCP response, or nested instruction may downgrade, waive, or
   raise a hard maximum at runtime: enforcement reads ONLY the decoded
   `Budget.Policy` and the recorded `Budget.Consumption`, and the `blocked` /
   `escalation` / `error` outcome is authoritative. The hard-maximum invariant is
   the pure engine's (`budget-policy.ts` header) — it is enforced, never
   re-decided at the seam.

> **Clarification (post-review) — per-response ceilings vs cumulative dimensions.**
> `max_context_tokens` / `max_output_tokens` are PER-RESPONSE window ceilings (the
> largest single response), NOT cumulative budgets — every step re-sends the full
> context, so comparing the cumulative token SUM against them spuriously breaches a
> valid multi-step session within a few steps. The re-evaluation therefore compares
> each dimension against a value of the right shape: `max_context_tokens` /
> `max_output_tokens` against the CURRENT response's spend; `max_turns`,
> `cost.token_budget`, and `cost.cost_usd` against the cumulative running total. The
> recorded consumption (FR-A2 / FR-D1 `budget_consumed`) stays the running total;
> only the evaluation mapping is corrected, at the consumption layer
> (`session/budget-consume.ts` `evaluateLiveBudget`). `max_turns` additionally has a
> PRE-turn gate (`turns_used + 1 > max_turns` → block before the turn starts) so the
> countable dimension is honored exactly; token/cost lateness is inherent to
> post-execution accounting and left as-is. Only `blocked` / `error` halt the turn;
> a resilience `escalation` is advisory in Phase 2b (no live counts until Phase 3).

### Group C — fan-out admission against real headroom (FR-C)

7. **FR-C1 — admit every spawn against real cost and token headroom.** Every Task
   spawn MUST pass `HierarchyDispatcher.admitDispatchFanout(policy, requested,
   headroom, perWorker)` (`hierarchy-dispatcher.ts:101`) with `headroom` computed
   as the REAL remaining budget — `cost_budget_usd`/`token_budget` MINUS the
   session's recorded consumption — rather than the full-budget, un-decremented
   headroom Feature 042 passed (`routing-hierarchy.ts:325`). A `perWorker`
   estimate (non-zero) MUST be supplied so cost/token headroom genuinely bounds
   the granted worker count, not `max_workers` alone.

8. **FR-C2 — the legacy nesting check is retained as a backstop.** Fan-out
   admission is IN ADDITION to the legacy subagent-depth/nesting gate
   (`tool/task.ts` depth walk, ~:178-193, reconciled with `hierarchy.max_depth`
   via `reconcileDepthCeiling`) and the `max_delegation_depth` engine check — the
   depth backstop is preserved; admission adds the worker/cost/token bound on top.

9. **FR-C3 — admission is engine-derived, never re-decided.** The granted worker
   count and the `admission_denied` outcome MUST be taken from the
   `admitDispatchFanout` / `planDispatch` envelope, never recomputed at the seam,
   so the admission decision and the dispatch decision cannot diverge.

### Group D — real accounting (FR-D)

10. **FR-D1 — persist real consumption in the decision accounting.**
    `decision.accounting.budget_consumed` (`routing-service.ts:332`) MUST reflect
    the post-execution recorded consumption for the session, instead of the
    hardcoded `ZERO_CONSUMPTION`. The persisted decision record then honestly
    carries what the turn spent.

11. **FR-D2 — the pre-execution admission stays.** The existing pre-execution
    zero-consumption admission (`routing-service.ts:293`) that surfaces a
    mis-specified policy as an explicit `error` MUST remain — it is the policy
    sanity check at decision time; FR-D1 changes only the RECORDED consumed
    snapshot, not the pre-execution gate.

### Group E — sensible defaults (FR-E)

12. **FR-E1 — enforcement is active out-of-box.** When no operator budget is
    configured, the runtime MUST apply the sensible default budget
    (`config-adapter.ts` `DEFAULT_ROUTING_BUDGET`, :38-50) so enforcement is
    ACTIVE by default. The defaults are the ones documented in ADR-0043 (the
    budget-defaults decision), grounded in the values persisted in `global:routing`
    (`max_turns` 8, `max_workers` 3, `max_context_tokens` 200000,
    `max_output_tokens` 8000, `token_budget` 800000, `max_delegation_depth` 2).

13. **FR-E2 — a default never overrides an explicit operator budget.** The
    defaults apply ONLY when the effective config origin is `default` (no project
    `routing` and no `global:routing` budget present). An explicit operator budget
    at either scope MUST win verbatim; the defaults are a floor for the absent
    case, never a ceiling imposed over a configured one.

> **Clarification (post-review) — enforcement is gated on effective activation.**
> "Active out-of-box" means active once Smart Routing is effectively ON, not always.
> The budget seam records + blocks ONLY when `activation.enabled && mode !== "never"`
> (active for both `auto` and `always`). Note the seams do NOT share one gate: budget
> enforcement = `enabled && mode !== "never"`; fan-out admission (`routing-hierarchy.ts`)
> and model resolution (`routing-resolve.ts`) = `enabled && mode === "auto"` (the
> pre-existing Feature 037 / 042 decision). This divergence is intentional — under
> `mode: "always"` budget enforcement runs while fan-out admission is inactive. A
> session with Smart Routing DISABLED (the shipped default `enabled:false`/`mode:"never"`)
> is byte-identical to pre-F043 — no recording, no re-evaluation, no block. The
> sensible default budget therefore protects the operator who ENABLES Smart Routing
> without configuring every numeric limit. Root-session consumption is cleared when
> the session's turn completes (mirroring the Feature 042 child-session clear), so a
> breach can never persist across prompts (permanent-brick fix) and the store never
> leaks one entry per session.

### Group F — back-compat and safety proof (FR-F)

14. **FR-F1 — total, non-throwing, hang-proof budget path.** A failure anywhere in
    the consumption-recording, re-evaluation, or admission path MUST degrade
    safely and NEVER crash or block the turn — mirroring the Feature 037 / 042
    safety contract. Recording is a best-effort side effect (a no-op on any
    error); admission failure degrades to the Feature 042 behavior (parent
    inheritance / `max_workers`-only). The ONE non-degrading outcome is a genuine
    budget BREACH (`blocked` / `escalation` / `error`), which is a deliberate
    typed value surfaced honestly — not a crash.

15. **FR-F2 — the dead exports gain production call sites.** After this feature,
    `grep` for `RoutingSessionState.recordConsumption` MUST return the new
    production seam, and `evaluateBudget` MUST have a non-`ZERO_CONSUMPTION` call
    site.

16. **FR-F3 — proven with real usage shapes.** Regression coverage MUST prove:
    (a) a completed response records real turn/token consumption; (b) consumption
    accumulates across turns; (c) a `max_turns` / `max_context_tokens` /
    `max_output_tokens` breach yields the explicit `blocked` outcome, never a
    truncated value; (d) `admitDispatchFanout` grants fewer workers as cost/token
    headroom shrinks; (e) `budget_consumed` reflects real consumption; (f) the
    default budget is enforced when no operator config is present, and an explicit
    operator budget overrides it; (g) an error in the budget path degrades without
    crashing the turn. No existing session/processor, routing, or `tool/task.ts`
    assertion is weakened.

## Non-Functional Requirements

- **Enforcement active by default, zero behavior change to output.** With the
  sensible default budget, enforcement runs but a within-budget session sees no
  observable change — recording is a side effect and the outcome is `ok`. Only a
  genuine breach changes behavior (an explicit typed block/escalation), and only
  once real spend exceeds a hard maximum.
- **The turn path is never blocked or crashed by the budget path.** Consumption
  recording and re-evaluation are wrapped so any error/defect degrades to a no-op;
  a breach is a deliberate typed outcome, distinct from a crash, surfaced before
  the next turn proceeds — never inside the LLM stream.
- **One engine, one config SSOT.** The runtime reuses the pure `budget-policy.ts`
  engine, the `RoutingSessionState` store, and the `routing` / `global:routing`
  config authorities; it introduces no parallel budget engine, consumption store,
  or defaults source.
- **Determinism.** Consumption is a deterministic function of the recorded usage;
  the engine outcome is a pure function of policy + consumption, so a breach is
  reproducible.

## Security Requirements

- **Data sensitivity/classification.** The runtime reads the routing/budget
  configuration document (operator metadata: hard-maximum limits) and the live
  LLM response usage (token counts, cost, elapsed time — operational telemetry,
  not content). It records only aggregate counts (turns, tokens, cost) into the
  in-memory `RoutingSessionState` and the redacted decision `budget_consumed`
  snapshot. It reads, logs, and persists NO message content, credential, or
  secret — only numeric spend.
- **Authentication/authorization.** No new authenticated surface or permission
  boundary. This feature NARROWS what a session may do: it enforces hard maximums
  and admission-controls fan-out against real headroom, so a model/plugin/nested
  instruction cannot spend past a configured budget. It can only ever confine —
  never widen — a session's spend.
- **Input validation.** The untrusted inputs are the LLM response usage (bounded
  and normalized through `Session.getUsage`, which clamps non-finite/negative
  values to safe non-negative counts, session.ts :339-341) and the requested
  fan-out count (admission-controlled by `admitDispatchFanout` to the min of
  requested / `max_workers` / cost / token headroom, so a hostile or runaway
  fan-out request cannot spawn an unbounded worker set). The budget config is
  decoded through the Feature 001 schema; a malformed policy fails the decode or
  yields an explicit `error` outcome, never a silent pass.
- **Cryptography in transit/at rest.** Not applicable — the runtime performs no
  new network I/O and persists no new at-rest data beyond the Feature 001 decision
  record (already redacted, written through the existing decision store). It
  records only numeric spend; it moves no secret.
- **Logging/audit.** No new logging of sensitive material. Consumption is
  correlated in the in-memory `RoutingSessionState` and the redacted decision
  `budget_consumed` snapshot; no message content, config payload, or credential
  is written to a log line.
- **Error-handling information exposure.** A budget-path FAILURE collapses to a
  no-op (no stack trace, config fragment, or usage detail surfaced). A budget
  BREACH surfaces only the typed engine outcome and its plain `Violation` reason
  (`dimension` / `limit` / `observed` + a fixed reason string, e.g. "turn count
  exceeds max_turns"), which names no secret and no message content.

## Acceptance Scenarios

Given the budget engine (`budget-policy.ts`) wired into the live session response
loop and the Task fan-out admission seam, with the `RoutingSessionState` store and
an effective budget policy

- **Real consumption recorded (FR-A1, FR-A2, FR-F3-a/b).**
  Given a session completes an LLM response with a known token usage,
  When the `step-finish` seam records consumption,
  Then `RoutingSessionState.get(sessionId).consumption` carries the real
  `turns_used` / `context_tokens_used` / `output_tokens_used`, accumulated across
  turns — no longer the dead zero snapshot.

- **`max_turns` breach → explicit block, not truncation (FR-B2, FR-B3, FR-F3-c).**
  Given the recorded `turns_used` exceeds `max_turns`,
  When the budget is re-evaluated mid-session,
  Then `evaluateBudget` returns `blocked` with a `max_turns` `Violation`, and the
  runtime surfaces it explicitly — the turn count is NEVER silently truncated and
  no instruction can relax the maximum.

- **`max_context_tokens` / `max_output_tokens` breach → explicit outcome (FR-B2).**
  Given the recorded context or output tokens exceed their hard maximum,
  When the budget is re-evaluated,
  Then the outcome is `blocked` with the corresponding `Violation`, surfaced
  honestly rather than reduced to fit.

- **Fan-out admission honors real headroom (FR-C1, FR-C3, FR-F3-d).**
  Given a session has consumed most of its `token_budget` / `cost_budget_usd`,
  When a Task spawn requests a fan-out,
  Then `admitDispatchFanout` grants `min(requested, max_workers, cost headroom,
  token headroom)` — fewer workers as headroom shrinks — and the granted count is
  taken from the envelope, not recomputed, in addition to the depth backstop.

- **Accounting reflects real consumption (FR-D1, FR-F3-e).**
  Given a turn recorded real consumption,
  When the decision is persisted,
  Then `decision.accounting.budget_consumed` carries the post-execution
  consumption, not `ZERO_CONSUMPTION`.

- **Defaults active out-of-box (FR-E1, FR-E2, FR-F3-f).**
  Given no operator budget is configured (effective origin `default`),
  When a session runs,
  Then the sensible default budget is enforced; and given an explicit operator
  budget at `routing` or `global:routing`, that budget wins verbatim.

- **Budget path is hang/crash-safe (FR-F1, FR-F3-g).**
  Given an error is thrown inside the consumption-recording or re-evaluation path,
  When a turn completes,
  Then the error degrades to a no-op and the turn proceeds — the budget path never
  crashes or blocks the turn, while a genuine breach remains a deliberate typed
  outcome.

## Observability

Phase 2b adds no new metrics, log events, or trace spans. The budget outcome
(`ok` / `blocked` / `escalation` / `error`) and the recorded consumption are plain
typed data carried on the `RoutingSessionState` and the redacted decision record;
surfacing a budget breach onto the OTLP telemetry seam (a span event / counter for
`budget.blocked` / `budget.escalation`) is deferred to Phase 3. The behavioral
change is confined to WHEN a session is blocked/escalated for exceeding a hard
maximum and HOW MANY workers a fan-out is granted, and only once real spend
crosses a configured limit. Conventions live in
`doc/arch/observability/observability.md`.

## Domain Model

The runtime records real consumption at the response loop, re-evaluates the pure
engine against it, feeds real headroom into fan-out admission, and persists the
real accounting:

```
processor.ts step-finish (:435-483)
  usage = Session.getUsage({ model, usage, metadata })          (:438)
     usage.tokens {input, output, reasoning, cache}  usage.cost (:444-445)
  consumption = accumulate(                                     (FR-A1, FR-A2)
     RoutingSessionState.get(sessionId).consumption ?? ZERO,
     { turns_used +1, context_tokens_used += usage.tokens.input,
       output_tokens_used += usage.tokens.output,
       cost { time_ms_used, cost_usd_used += usage.cost } })
  RoutingSessionState.recordConsumption(sessionId, consumption) (FR-A1, no longer dead)
        |
        v
  evaluateBudget(config.enforcement.budget, consumption)        (FR-B1, budget-policy.ts:321)
     checkLimits: turns/context/output over max -> blocked      (FR-B2)
     checkCost:   time/cost/token over budget    -> blocked
     checkResilience: retry/validation over depth -> escalation
     non-finite policy                            -> error
     outcome ok | blocked | escalation | error  (never truncate) (FR-B3)
        |
        v
routing-hierarchy.ts fan-out admission (:325-328)
  headroom = { costUsd: cost_budget_usd - consumed.cost_usd_used,   (FR-C1)
               tokens:  token_budget    - consumed.tokens_used }
  perWorker = { costUsd: est, tokens: est }  (non-zero)
  admitDispatchFanout(policy, requested, headroom, perWorker)   (FR-C1, FR-C3)
     granted = min(requested, max_workers, cost headroom, token headroom)
  + legacy subagent-depth backstop (tool/task.ts ~:178-193)     (FR-C2)
        |
        v
routing-service.ts decision.accounting
  budget_consumed = recorded consumption  (was ZERO_CONSUMPTION :332) (FR-D1)
  pre-execution zero admission at :293 unchanged                (FR-D2)

defaults: config-adapter.ts DEFAULT_ROUTING_BUDGET (:38-50) applied
  only when effective origin == "default" (no operator budget)  (FR-E1, FR-E2)
```

## Out of Scope

- **Retrieval-dimension live consumption** — recording real `retrieval_chunks_used`
  / `rerank_chunks_used` / `skill_*` counts from Feature 006 retrieval is Phase 3;
  this feature records the throughput and cost dimensions from the LLM response.
- **Resilience-dimension live counts** — recording real `retry_count` /
  `validation_count` from the fallback state machine is Phase 3; the engine
  already checks them, but this feature feeds only turn/token/cost spend.
- **Telemetry surfacing** of the budget-breach outcome onto OTLP spans/metrics
  (Phase 3).
- **The operator-stack `InstanceRef` candidate-resolver fix**
  (`operator/stack-live.ts:314/341`) — side-stepped via the session-local
  composition, as in Phase 1 / 2 (Phase 3).
- **`always` / `never` mode routing** — fan-out admission engages only when
  hierarchy routing is active (`auto`); the consumption recording and the
  hard-maximum re-evaluation are unconditional (they enforce the budget for every
  session, routed or not, via the default budget).

## Clarifications

### Session 2026-07-21

Declarative resolutions for the Feature 043 clarify dimension. Each decision
closes an open marker in the body with a conservative, tunable default and a
named acceptance hook (AC = Acceptance Scenario above). This section fixes the
decisions ADR-0043 formalizes; it does not author the ADR.

- **C1 — the consumption-recording seam is `processor.ts` `step-finish`.** Real
  per-response usage is known at `Session.getUsage(...)` (:438); one completed
  step is one turn; `usage.tokens.input` maps to `context_tokens_used` and
  `usage.tokens.output` to `output_tokens_used`; `usage.cost` maps to
  `cost_usd_used`. Consumption ACCUMULATES onto the session's prior recorded
  spend (FR-A2), never overwrites. Acceptance hook AC "Real consumption recorded".

- **C2 — a hard-maximum breach is an explicit typed outcome, never truncation.**
  When `checkLimits` / `checkCost` report `observed > limit`, the runtime surfaces
  the engine's `blocked` / `escalation` / `error` outcome with the `Violation`
  preserved; it NEVER caps or reduces the value to fit. No model output, plugin,
  MCP response, or nested instruction may relax the maximum (FR-B3). Acceptance
  hook AC "`max_turns` breach → explicit block, not truncation".

- **C3 — fan-out headroom is budget MINUS recorded consumption.** The
  `admitDispatchFanout` `headroom` is the REAL remaining budget (`cost_budget_usd`
  / `token_budget` minus the session's recorded `cost_usd_used` / tokens used),
  with a non-zero `perWorker` estimate, superseding Feature 042's full-budget,
  ZERO-per-worker admission (`routing-hierarchy.ts:325-328`). Acceptance hook AC
  "Fan-out admission honors real headroom".

- **C4 — sensible defaults active out-of-box (the "ADR de defaults sensatos").**
  Spec 001 approved NO numeric defaults; this feature adopts a sensible default
  budget so enforcement is ACTIVE when an operator sets nothing, grounded in the
  values persisted in `global:routing` (`max_turns` 8, `max_workers` 3,
  `max_context_tokens` 200000, `max_output_tokens` 8000, `token_budget` 800000,
  `max_delegation_depth` 2) and the existing `DEFAULT_ROUTING_BUDGET` fallback.
  The defaults apply ONLY when no operator budget is present (origin `default`);
  an explicit operator budget always wins (FR-E2). The full table and rationale
  are in ADR-0043. Acceptance hook AC "Defaults active out-of-box".

- **C5 — the budget path is hang/crash-safe (Feature 037 / 042 contract).**
  Consumption recording and re-evaluation are wrapped so any error/defect degrades
  to a no-op; the turn never crashes or blocks on the budget path. A genuine breach
  is the one non-degrading, deliberate typed outcome. Acceptance hook AC "Budget
  path is hang/crash-safe".

## Related Features and Decisions

- [ADR-0043 — Enforce live budget consumption and fan-out admission across the session](../../adr/0043-enforce-live-budget-consumption-and-fanout-admission-across.md)
- [Feature 037 — Wire the operator Smart Routing engine into the live session](../037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md) — Phase 1 (the top-level implicit-default resolver and the hang/crash-safety contract this feature mirrors; budget enforcement was its explicit Phase 2).
- [Feature 042 — Wire per-subagent hierarchy delegation into the Task spawn](../042-wire-per-subagent-hierarchy-delegation-into-the-task-spawn/spec.md) — Phase 2a (the `admitDispatchFanout` gate this feature feeds with real headroom; budget consumption enforcement was its explicit Phase 3 residual).
- [Feature 001 — Define one cohesive Smart Agent Routing and OpenTelemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — the pure `budget-policy.ts` engine (`checkLimits` / `admitFanout` / `evaluateBudget`), the `Budget.Consumption` value object, and the `RoutingSessionState` store this feature wires; Spec 001 approved no numeric defaults, which this feature's defaults decision closes.
- [Feature 006 — Add Milvus-backed multilingual semantic retrieval](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — the retrieval dimension whose live consumption (`retrieval_chunks_used` / `rerank_chunks_used` / `skill_*`) is deferred to Phase 3.
- The `Budget.Consumption` value object recorded here is bound by `doc/arch/schemas/routing/budget-consumption.cue` (`#BudgetConsumption` over throughput / concurrency / retrieval / cost / resilience).
