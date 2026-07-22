---
status: accepted
date: 2026-07-21
deciders: [project maintainers]
consulted: []
informed: []
---

# 0043 — Enforce Live Budget Consumption And Fanout Admission Across The Session

## Context and Problem Statement

Feature 001 built a complete budget model: a pure, unit-tested enforcement engine
(`routing/domain/budget-policy.ts` — `checkLimits` / `admitFanout` /
`evaluateBudget`, plus `checkCost` / `checkResilience` / `checkDelegationDepth`)
that treats every `Budget.Policy` hard maximum as a value a model, plugin, MCP
call, or nested instruction may NEVER relax, and a session state store
(`session/routing-state.ts` `recordConsumption`) that carries observed spend for a
Session. Feature 037 Phase 1 wired the routing engine into the top-level model,
and Feature 042 Phase 2a wired per-subagent hierarchy delegation into the Task
spawn — but both carried only a budget SNAPSHOT and explicitly deferred budget
consumption enforcement.

The result: the budget engine and the consumption store are fully implemented and
tested but have ZERO runtime enforcement call sites. `evaluateBudget` runs exactly
once per decision as a ZERO-consumption sanity check
(`routing-service.ts:293` `evaluateBudget(config.enforcement.budget,
ZERO_CONSUMPTION)`), `decision.accounting.budget_consumed`
(`routing-service.ts:332`) persists the ZERO snapshot, `recordConsumption`
(`routing-state.ts:131-133`) is dead code, and the Feature 042 fan-out gate feeds
`admitDispatchFanout` a full, un-decremented budget as headroom with a ZERO
per-worker estimate (`routing-hierarchy.ts:325-328`) — so `max_workers` is the
only live admission factor. A session can spend past `max_turns`,
`max_context_tokens`, `max_output_tokens`, and `token_budget` with nothing
enforcing the hard maximums the engine was built to hold.

Two design questions have no prior decision: (1) how to wire real per-turn /
per-token consumption into the runtime and enforce the hard maximums as EXPLICIT
typed outcomes (never silent truncation) without ever crashing or blocking the
turn; and (2) whether the feature should ship with NO numeric defaults (Spec 001
approved none) or with a SENSIBLE default budget so enforcement is active
out-of-box even when an operator sets nothing.

## Decision Drivers

- **A hard maximum must be enforced at runtime, never merely unit-tested.** A
  breach must be an explicit `blocked` / `escalation` / `error`, never a silently
  truncated or reduced value.
- **A model / plugin / nested instruction can never relax a hard maximum.**
  Enforcement reads only the decoded policy and the recorded consumption; the
  outcome is authoritative.
- **Real consumption, real headroom, real accounting.** The engine must evaluate
  against what the session actually spent; fan-out must admit against real
  remaining cost/token headroom; the persisted accounting must reflect real spend.
- **Zero behavior change to a within-budget session; never crash or block the
  turn.** Recording is a side effect and a within-budget outcome is `ok`; every
  failure degrades to a no-op.
- **Enforcement active out-of-box.** Enforcement should not be dormant until an
  operator configures every numeric limit — a sensible default should apply when
  config is absent, while any explicit operator budget always wins.
- **Reuse the one engine, one config SSOT, and the Phase 1 / 2 safety pattern.**
  No parallel budget engine, consumption store, or defaults source.
- **Give the dead engine/store exports their first production consumers.**

## Considered Options

### Overall wiring

- **Option A — record consumption at the response loop, enforce mid-session, admit
  fan-out against real headroom, persist real accounting (chosen).** Record real
  per-response usage at `processor.ts` `step-finish` into
  `RoutingSessionState.recordConsumption` (accumulated across turns); re-run
  `evaluateBudget` against the accumulated consumption and surface an explicit
  `blocked` / `escalation` / `error`; feed real cost/token headroom (budget minus
  recorded consumption) into the Feature 042 `admitDispatchFanout` gate; set
  `decision.accounting.budget_consumed` from the recorded consumption. Reuses the
  one engine, the one config SSOT, the `RoutingSessionState` store, and the
  Phase 1 / 2 hang/crash-safety contract; a within-budget session is a no-op.
- **Option B — enforce the budget inside the LLM stream.** Rejected: the token
  usage is settled only at `step-finish` (`processor.ts:438`), and enforcing
  mid-stream would entangle budget with streaming/retry and risk blocking or
  crashing the turn. Enforcement belongs BETWEEN turns, at the response loop.
- **Option C — a parallel consumption tracker outside `RoutingSessionState`.**
  Rejected: it would duplicate the store the engine already correlates a Session's
  spend through, and split the SSOT. The dead `recordConsumption` sink is exactly
  the intended seam.

### Silent truncation vs explicit outcome (open question 1)

- **Option A1 — an exceeded hard maximum is an explicit typed outcome (chosen).**
  When `checkLimits` / `checkCost` report `observed > limit`, surface the engine's
  `blocked` / `escalation` / `error` with the `Violation` preserved; NEVER cap or
  reduce the value to fit. The hard-maximum invariant (`budget-policy.ts` header)
  is enforced, never re-decided at the seam, so no model output or nested
  instruction can relax it.
- **Option A2 — truncate/cap the request to fit the budget.** Rejected: silent
  truncation hides the breach, contradicts the "a model may never relax a hard
  maximum" invariant, and produces a wrong-but-quiet result instead of an honest
  block. The whole point of the engine is an explicit outcome.

### No defaults vs sensible defaults (open question 2)

- **Option B1 — ship a sensible default budget so enforcement is active
  out-of-box (chosen).** Spec 001 approved no numeric defaults, leaving enforcement
  dormant until an operator configures every limit. Instead, adopt a conservative,
  documented default budget (the existing `config-adapter.ts`
  `DEFAULT_ROUTING_BUDGET`, reconciled to the values persisted in `global:routing`)
  applied ONLY when the effective config origin is `default` (no operator budget at
  `routing` or `global:routing`). An explicit operator budget always wins verbatim;
  the defaults are a floor for the absent case, never a ceiling over a configured
  one. This is the "ADR de defaults sensatos" the user explicitly authorized.
- **Option B2 — no defaults; enforcement inert until fully configured.** Rejected:
  it ships a feature whose enforcement does nothing out-of-box, so the common
  operator (who sets nothing) gets no protection and the hard maximums the engine
  holds never fire. A conservative, documented, overridable default is required.
- **Option B3 — hardcode defaults that override operator config.** Rejected: a
  default must never override an explicit operator budget; that would invert the
  SSOT and surprise an operator who configured a deliberate limit.

## Decision Outcome

Chosen option: **Option A** (record at the response loop, enforce mid-session,
admit against real headroom, persist real accounting), combined with **Option A1**
(an exceeded hard maximum is an explicit typed outcome, never truncation) and
**Option B1** (a sensible default budget, active out-of-box, overridable). Wiring
the pure engine and the `RoutingSessionState` store into the runtime lets the
budget be enforced against what the session actually spent — reusing the one engine
and config SSOT, honoring an explicit operator budget verbatim, leaving a
within-budget session a no-op, and degrading every failure to a no-op so the turn
never crashes or blocks, while a genuine breach is a deliberate typed outcome.

Key decisions recorded:

1. **Phase 2b wires the budget dimension of Feature 037 Phase 2.** Phase 1 wired
   the top-level model; Phase 2a wired hierarchy delegation; Phase 2b records real
   consumption, enforces the hard maximums mid-session, admits fan-out against real
   headroom, and persists real accounting. Retrieval/resilience live consumption,
   telemetry surfacing, and the operator `InstanceRef` fix are Phase 3.
2. **Consumption is recorded at the `processor.ts` `step-finish` response loop.**
   Real per-response usage (`Session.getUsage`, `usage.tokens.input` → context
   tokens, `usage.tokens.output` → output tokens, one step → one turn,
   `usage.cost` → cost) is accumulated onto the session's prior recorded
   consumption via `RoutingSessionState.recordConsumption` — its first production
   call site.
3. **The budget is re-evaluated mid-session against real consumption.**
   `evaluateBudget(effectiveBudget, recordedConsumption)` — the first
   non-`ZERO_CONSUMPTION` call site — runs after recording; a breach is surfaced as
   the engine's explicit outcome.
4. **A hard maximum is an explicit typed outcome, never truncation (Option A1).**
   `blocked` for a limits/cost breach, `escalation` for a resilience threshold,
   `error` for a non-finite policy, with every `Violation` preserved. No model,
   plugin, MCP response, or nested instruction may relax a hard maximum.
5. **Fan-out is admitted against real cost/token headroom.**
   `admitDispatchFanout` receives `headroom = budget - recorded consumption` and a
   non-zero `perWorker` estimate (superseding Feature 042's full-budget,
   ZERO-per-worker admission), so a spawn is granted
   `min(requested, max_workers, cost headroom, token headroom)` — in addition to
   the legacy subagent-depth backstop. The granted count is taken from the
   envelope, never recomputed.
6. **Accounting reflects real consumption.**
   `decision.accounting.budget_consumed` is set from the recorded consumption
   instead of `ZERO_CONSUMPTION`; the pre-execution zero admission
   (`routing-service.ts:293`) that surfaces a mis-specified policy is unchanged.
7. **A sensible default budget, active out-of-box, overridable (Option B1).** The
   defaults (below) apply only when no operator budget is present; an explicit
   operator budget always wins verbatim.
8. **Total, non-throwing, hang-proof fallback + back-compat.** Any failure in the
   recording, re-evaluation, or admission path degrades to a no-op — the Feature
   037 / 042 contract — so the turn never crashes or blocks. A budget breach is the
   one non-degrading, deliberate typed outcome. A within-budget session is a no-op.
9. **The dead exports gain production consumers.** `RoutingSessionState.recordConsumption`
   and a non-`ZERO_CONSUMPTION` `evaluateBudget` call gain their first production
   call sites.

### Budget defaults (the sensible-defaults decision)

Applied ONLY when the effective config origin is `default` (no project `routing`
and no `global:routing` budget). Grounded in the values persisted in the
`global:routing` operator authority and the existing `config-adapter.ts`
`DEFAULT_ROUTING_BUDGET`. Every value is operator-overridable at either scope; a
default never overrides an explicit operator budget.

| Dimension | Default | Rationale |
| --- | --- | --- |
| `limits.max_turns` | 8 | Bounds a single session's turn count to a sane working ceiling; a runaway loop is blocked rather than spinning indefinitely. Matches the persisted `global:routing` value. |
| `limits.max_context_tokens` | 200000 | A generous large-context window; a session that exceeds it is blocked before an oversized/expensive context is assembled. |
| `limits.max_output_tokens` | 8000 | A large single-response output ceiling; bounds runaway generation while accommodating long, legitimate answers. |
| `concurrency.max_workers` | 3 | Caps parallel fan-out per dispatch to a small, reviewable set; combined with real cost/token headroom, prevents an unbounded worker explosion. Matches `global:routing`. |
| `concurrency.max_delegation_depth` | 2 | The Architect → Manager → Worker invariant (ADR-0002); delegation can never nest deeper. |
| `cost.token_budget` | 800000 | The aggregate token ceiling across a session's turns; the running total is enforced by the mid-session re-evaluation and bounds fan-out headroom. Matches `global:routing`. |

The remaining dimensions retain the existing `DEFAULT_ROUTING_BUDGET` values as
conservative, overridable defaults until an operator supplies its own:
`limits.max_context_bytes` / `max_output_bytes`, `retrieval.*`
(`retrieval_top_k` / `rerank_top_k` / `max_skill_chunks` / `max_skill_tokens`),
`cost.time_budget_ms` / `cost_budget_usd`, and `resilience.*`
(`retry_depth` / `validation_depth` / `escalation_threshold`). The plan reconciles
the numeric drift between the existing `DEFAULT_ROUTING_BUDGET` (`max_turns` 10,
`max_workers` 4, `token_budget` 1000000) and this grounded table so the out-of-box
floor matches the documented decision.

### Post-implementation clarifications (adversarial review)

The initial implementation shipped two defects that materially change the
documented behavior; the corrections are recorded here so the ADR stays truthful.

1. **Enforcement is gated on effective activation — "active out-of-box" means once
   Smart Routing is ON, not always.** The first cut enforced the tightened default
   budget on EVERY session regardless of activation, so an out-of-box session
   (`activation.enabled:false`/`mode:"never"`, the shipped default) hit the
   `max_turns` breach, set `ctx.blocked`, and — because root-session consumption was
   never reset — re-breached on every subsequent prompt, permanently bricking the
   session. The budget seam now enforces (records + blocks) ONLY when Smart Routing
   is effectively on — the gate is `activation.enabled && mode !== "never"` (active
   for both `auto` and `always`). The gates are NOT identical across seams: budget
   enforcement uses `enabled && mode !== "never"`, whereas the fan-out admission
   resolver (`routing-hierarchy.ts`) and the model resolver (`routing-resolve.ts`)
   gate on `enabled && mode === "auto"` (the pre-existing Feature 037 / 042
   decision). This divergence is intentional — budget enforcement should run
   whenever routing is enabled and not `never`, while fan-out admission stays
   `auto`-only. Consequence: under `mode: "always"` the budget seam records + applies
   the pre-turn `max_turns` block + can set `ctx.blocked`, while fan-out admission is
   inactive. The sensible default budget therefore protects the operator who ENABLES
   Smart Routing without configuring every numeric limit; a session with Smart
   Routing disabled (the default) is byte-identical to pre-F043 (no recording, no
   re-evaluation, no block). Root-session consumption is also cleared when the
   session's turn completes (mirroring the Feature 042 child-session clear), so a
   breach can never persist across prompts and the store never leaks one entry per
   session.
2. **Per-response ceilings vs cumulative dimensions.** `max_context_tokens` /
   `max_output_tokens` are PER-RESPONSE window ceilings (the largest single
   response), NOT cumulative budgets — every step re-sends the full context, so
   comparing the cumulative token SUM against them spuriously breaches within a few
   steps. Enforcement now compares each dimension against a value of the right
   shape: `max_context_tokens` / `max_output_tokens` against the CURRENT response's
   spend; `max_turns`, `cost.token_budget`, and `cost.cost_usd` against the
   cumulative running total (which stays the recorded `accounting.budget_consumed`,
   FR-D1). The recorded consumption remains the running total (FR-A2); only the
   EVALUATION mapping is corrected at the consumption layer.
3. **`max_turns` is gated PRE-turn.** The countable turn dimension is checked
   before a turn starts (`turns_used + 1 > max_turns` → block), so `max_turns` is
   honored exactly rather than one turn late. Token/cost lateness is inherent to
   post-execution accounting and is left as-is (documented).
4. **`escalation` is not a hard stop.** Only `blocked` / `error` set `ctx.blocked`;
   a resilience `escalation` is advisory here (its live counts are Phase 3), so it
   never halts the turn in Phase 2b. A genuine fiber interruption in the budget path
   is re-raised (never swallowed), and the effective-config resolution is memoized by
   the routing authorities' CAS VERSIONS (a decode-free stable key) rather than
   config-object identity — `Config.getGlobal()` returns a fresh merged object on
   every call under a global profile (the deployed config model), so an identity key
   would never hit and `resolveEffective` (schema decode + contentHash) would run on
   every step; the version key hits under a profile yet invalidates on a real config
   change. Per-worker fan-out pricing reserves `max_context_tokens + max_output_tokens`
   per worker (cost derived from a documented per-1k-token rate) so the cost/token
   admission gates are conservative but not inert.

Known limitations / intentional edges (Phase 2b):

- **`max_context_tokens` under-enforces by cache-read/write tokens.** The
  per-response context ceiling compares against `usage.tokens.input`, which excludes
  provider cache-read/write tokens, so the true context window can slightly exceed
  the ceiling before a breach. This is the SAFE direction (never a spurious breach);
  a cache-inclusive token count is deferred.
- **Interrupt re-raise uses `Cause.hasInterruptsOnly`.** A pure user-abort is
  correctly re-raised; the swallow only affects the rare mixed-cause window where a
  genuine `Fail`/`Die` co-occurs with the interrupt in the same cause. (This effect
  version exposes `hasInterruptsOnly`, not `isInterruptedOnly`.)
- **The root finalizer clears the ENTIRE `RoutingSessionState` entry**, not just the
  consumption field. Verified benign: the decision reference and hierarchy role are
  re-recorded at the start of each prompt before any read, so nothing stale is
  observed. Intentional — one `clear` mirrors the Feature 042 child-session clear.

### Consequences

- Good: the budget engine finally governs the runtime — a session's real spend is
  recorded, the hard maximums are enforced as explicit typed outcomes, and fan-out
  is admission-controlled against real headroom, not just unit-tested.
- Good: a hard maximum can never be silently truncated or relaxed by a model,
  plugin, MCP call, or nested instruction — a breach is honest and typed.
- Good: `decision.accounting.budget_consumed` reflects real spend for replay and
  audit, instead of a persisted zero snapshot.
- Good: enforcement is ACTIVE out-of-box via sensible, documented, overridable
  defaults — the common operator who sets nothing is protected — while an explicit
  operator budget always wins.
- Good: a within-budget session is a byte-for-byte no-op to output; only a genuine
  breach changes behavior, and only once real spend crosses a configured limit.
- Good: the turn path can never crash or block on the budget path — every failure
  degrades to a no-op; a breach is a deliberate typed outcome, not a crash.
- Good: `RoutingSessionState.recordConsumption` and a non-`ZERO_CONSUMPTION`
  `evaluateBudget` gain their first production call sites.
- Neutral: Phase 2b records only the throughput and cost dimensions; retrieval and
  resilience live counts remain zero until Phase 3, so those dimensions are checked
  against zero observed spend for now.
- Residual (Phase 3): retrieval-dimension live consumption (Feature 006 chunk
  counts), resilience-dimension live counts, telemetry surfacing of the
  budget-breach outcome, the operator-stack `InstanceRef` fix
  (`stack-live.ts:314/341`), and `always`-mode fan-out routing are deferred.

## Related

- Feature specification: [043 Enforce live budget consumption and fan-out admission across the session](../sdd/043-enforce-live-budget-consumption-and-fanout-admission-across/spec.md)
- Phase 1 (the top-level implicit-default resolver and the hang/crash-safety contract this feature mirrors; budget enforcement was its explicit Phase 2): [037 Wire the operator Smart Routing engine into the live session](../sdd/037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md)
- Phase 2a (the `admitDispatchFanout` gate this feature feeds with real headroom; budget consumption enforcement was its explicit Phase 3 residual): [042 Wire per-subagent hierarchy delegation into the Task spawn](../sdd/042-wire-per-subagent-hierarchy-delegation-into-the-task-spawn/spec.md)
- The pure `budget-policy.ts` engine, the `Budget.Consumption` value object, the `RoutingSessionState` store, and the `ZERO_CONSUMPTION` admission this feature wires; Spec 001 approved no numeric defaults, which this feature's defaults decision closes: [001 Define one cohesive Smart Agent Routing and OpenTelemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- The hierarchical adaptive routing model (Architect → Manager → Worker, depth ≤ 2) the `max_delegation_depth` default enforces: [ADR-0002 Core Smart Agent Routing](0002-core-smart-agent-routing.md)
- Records the composition, safety, and back-compat contract this feature mirrors: [ADR-0037 Wire the operator Smart Routing engine into the live session](0037-wire-the-operator-smart-routing-engine-into-the-live-session.md)
- Records the fan-out admission gate this feature feeds real headroom: [ADR-0042 Wire per-subagent hierarchy delegation into the Task spawn](0042-wire-per-subagent-hierarchy-delegation-into-the-task-spawn.md)
- The `global:routing` authority that persists the budget values the defaults are grounded in: [033 Add a global authority scope for the pools (role_pools) operator config](../sdd/033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md)

## Links

- Related: ADR-0044, ADR-0049, ADR-0055, ADR-0053.
