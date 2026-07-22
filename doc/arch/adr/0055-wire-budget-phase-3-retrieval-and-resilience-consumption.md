---
status: accepted
date: 2026-07-22
deciders: [project maintainers]
consulted: []
informed: []
---

# 0055 — Wire Budget Phase 3 Retrieval And Resilience Consumption

## Context and Problem Statement

ADR-0043 Phase 2b (Feature 043) records live throughput and cost consumption and
enforces hard maximums mid-session. Its Phase 3 residual deferred retrieval-dimension
live consumption and remaining resilience live counts. Later features closed other
residuals (Feature 039 InstanceRef, 045 always-mode fan-out, 047 budget telemetry,
050 `retry_count`). Retrieval spend and `validation_count` still accumulate as zero,
so `checkRetrievalConsumption` and resilience `validation_depth` never observe real
spend. How should those remaining dimensions be wired without splitting the budget
SSOT or reintroducing multi-turn spurious breaches?

## Decision Drivers

- Real observed spend for every budget dimension the pure engine already checks.
- Per-turn retrieval ceilings must not spuriously breach multi-turn sessions
  (same class of bug Feature 043 fixed for max_context_tokens).
- Hang/crash-safe recording; no operator payload or command-id change.
- One `accumulateConsumption` path — no parallel retrieval ledger.
- Close only the open ADR-0043 Phase 3 consumption residuals; do not re-do 039/045/047/050.

## Considered Options

- **Option A — Extend `ConsumptionDelta` and record at the narrowing and worker-validation seams.**
  Fold optional retrieval and validation fields into the existing accumulation helper;
  record after live `narrowForTurn`; increment `validation_count` when worker domain
  validation runs; evaluate retrieval policy against the current turn's retrieval
  delta (per-turn ceilings) while resilience stays cumulative.
- **Option B — Parallel retrieval ledger outside `Budget.Consumption`.** Rejected: splits
  the SSOT the engine already correlates through `RoutingSessionState`.
- **Option C — Accounting-only, no enforcement evaluation.** Rejected: leaves
  `checkRetrievalConsumption` / `validation_depth` dead against permanent zeros.

## Decision Outcome

Chosen option: **Option A — extend `ConsumptionDelta` and record at the narrowing and
worker-validation seams**, because it reuses the Feature 043 accumulation and
activation path, closes the last open Phase 3 consumption residuals without a second
store, and applies the per-turn evaluation shape already proven for token ceilings.

Key decisions:

1. **Retrieval fields** (`retrieval_chunks_used`, optional rerank/skill chunk counts,
   `skill_tokens_used`) accumulate from live semantic narrowing / auto-skill outcomes
   when Smart Routing enforcement is active.
2. **Retrieval policy leaves** are per-turn ceilings: evaluation uses the current turn's
   retrieval delta; the recorded running total remains for accounting.
3. **`validation_count`** increments on the parent session when orchestration domain
   validation runs for a completed Worker (`validationPerformed: true`).
4. **Optional delta fields** omitted ⇒ zero (byte-identical pre-055 call sites).
5. **Hang/crash-safe** recording; defects degrade to no-op. Telemetry, InstanceRef,
   always-mode fan-out, and `retry_count` stay owned by 047/039/045/050.
6. **`escalation` remains non-hard-stop**; live counts make the advisory signal real.

### Consequences

- Good: retrieval and validation hard-max checks become live against real spend.
- Good: closes the open ADR-0043 Phase 3 consumption residuals without re-authoring
  completed later features.
- Good: pre-055 call sites without new delta fields remain byte-identical.
- Neutral: `escalation` stays advisory unless a later product decision elevates it.
- Residual: retrieval byte fields; elevating escalation to a hard stop.

## Related

- ADR-0043 Phase 3 residual and Feature 043 Phase 2b
- Features 050 (`retry_count`), 051/052 (live narrowing + auto-skill), 047 (telemetry)
- Feature 055 specification

## Links

- Related: ADR-0042, ADR-0053.
