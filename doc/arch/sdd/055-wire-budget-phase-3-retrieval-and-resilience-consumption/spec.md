---
id: 019f877d-32b0-7ac3-a3d4-f54626d5f4c6
number: 055
slug: wire-budget-phase-3-retrieval-and-resilience-consumption
status: implemented
created_at: 2026-07-22T01:42:36.976587Z
---
# Feature Specification: Wire Budget Phase 3 Retrieval And Resilience Consumption

Feature: 055-wire-budget-phase-3-retrieval-and-resilience-consumption
Created: 2026-07-22

## Context

Feature 043 Phase 2b records live **throughput** and **cost** consumption and
enforces hard maximums mid-session. ADR-0043 deferred Phase 3: retrieval-dimension
live consumption, remaining resilience live counts (`validation_count` /
`escalation_count`), and related follow-through. Later features already closed
other Phase 3 residuals outside this scope:

- **Telemetry** budget.consumption / budget.breach — Feature 047
- **InstanceRef** candidate-resolver bind — Feature 039
- **always-mode fan-out admission** — Feature 045 (`mode !== "never"`)
- **retry_count** from semantic data-plane retries — Feature 050 FR12

This feature wires the **remaining live dimensions** into
`RoutingSessionState.recordConsumption` so `checkRetrievalConsumption` and
`checkResilience` evaluate real observed spend, not permanent zeros.

## User Stories

- As a maintainer, I want each turn's semantic retrieval (agents/skills/tools
  candidates and auto-skill chunks/tokens) recorded into budget consumption so
  retrieval hard maximums enforce real spend.
- As a maintainer, I want worker domain-validation events to increment
  `validation_count` so resilience `validation_depth` can escalate honestly.
- As a user with Smart Routing on, I want retrieval/resilience breaches to surface
  as the engine's typed outcomes (blocked / escalation) without silent truncation
  and without crashing the turn.

## Functional Requirements

1. **FR1 — retrieval delta.** After a live `narrowForTurn` that actually ran
   retrieval (not gates-off / memo-only passthrough), the runtime MUST accumulate
   into `Budget.Consumption.retrieval`:
   - `retrieval_chunks_used` += count of ranked candidates considered across
     agents + skills + tools surfaces (revalidated kept length is the spend),
   - `rerank_chunks_used` += tools (or total) rerank surface size when present,
   - `skill_chunks_used` / `skill_tokens_used` += auto-skill chunk count and an
     estimated token spend for injected chunks when Tier-2 runs.
2. **FR2 — retrieval evaluation shape.** Like `max_context_tokens`, retrieval
   policy leaves (`retrieval_top_k`, `rerank_top_k`, `max_skill_chunks`,
   `max_skill_tokens`) are **per-turn ceilings**. The recorded consumption remains
   a session running total for accounting; `evaluateLiveBudget` MUST compare
   retrieval policy against the **current turn's retrieval delta**, not the
   cumulative sum (avoids spurious multi-turn breaches).
3. **FR3 — validation_count.** When orchestration domain validation runs for a
   completed child (`validationPerformed: true` on the worker validation chain),
   increment `resilience.validation_count` by 1 on the **parent** session's
   consumption (the Manager that delegated). Hang/crash-safe; never fails the
   fold path.
4. **FR4 — accumulation API.** Extend `ConsumptionDelta` /
   `accumulateConsumption` with optional retrieval and validation fields;
   missing fields mean zero (byte-identical to pre-055 for old call sites).
5. **FR5 — hang/crash-safe + activation gate.** Recording reuses the Feature 043
   activation gate (Smart Routing on, `mode !== "never"`) where the caller is
   session-budget aware; semantic narrowing may record only when a routing store
   is available and enforcement is active. Defects degrade to no-op.
6. **FR6 — no contract change.** No operator payload, command id, or catalog
   change. Pure consumption wiring + tests.

## Security Requirements

- **Data sensitivity/classification.** Numeric counters only (chunk counts,
  token estimates, validation counts). No prompt or file content.
- **Authentication/authorization.** Not applicable — no new surface.
- **Input validation.** Counts clamped non-negative finite; malformed → 0.
- **Cryptography in transit/at rest.** Not applicable.
- **Logging/audit.** No new content-bearing logs; reuse content-free debug rows.
- **Error-handling information exposure.** Failures degrade to no-op; no sensitive
  error text added to the user turn.

## Acceptance Scenarios

- **AC1.** A turn that runs semantic narrowing with N kept tool candidates records
  `retrieval_chunks_used` (and related fields) ≥ N on the session consumption.
- **AC2.** A multi-turn session does NOT spuriously breach `retrieval_top_k` solely
  because cumulative chunk counts sum across turns; per-turn evaluation is used.
- **AC3.** A Manager that completes a Worker with domain validation increments
  `validation_count` by 1 on the Manager session consumption.
- **AC4.** Pre-055 call sites of `accumulateConsumption` without new fields remain
  byte-identical.
- **AC5.** An error in retrieval/validation recording never crashes the turn.

## Observability

No new telemetry keys. Existing Feature 047 `budget.consumption` /
`budget.breach` continue to fire from the processor seam when throughput/cost
(and now retrieval/resilience) evaluation breaches. Content-free dimensions only.

## Non-Goals

- Re-implementing Features 039 / 045 / 047 / 050.
- Changing operator config shapes or DEFAULT_ROUTING_BUDGET table.
- Making `escalation` a hard stop (remains advisory unless product later elevates
  it; live counts make the signal real).
- Retrieval byte accounting.

## Related

- ADR-0043 Phase 3 residual; Feature 043 Phase 2b; Feature 050 retry_count;
  Feature 051/052 live narrowing + auto-skill; Feature 047 telemetry.

## Clarifications
