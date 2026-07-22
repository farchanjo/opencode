# Implementation Plan: Wire Budget Phase 3 Retrieval And Resilience Consumption

## Overview

Close the remaining ADR-0043 Phase 3 consumption residuals: record live
**retrieval** spend from semantic narrowing / auto-skill, and live
**validation_count** from orchestration domain validation, into
`RoutingSessionState` via the Feature 043 accumulation path. Retrieval policy
leaves evaluate against the **current turn's retrieval delta** (per-turn ceilings,
same class of fix as max_context_tokens in Feature 043). Features 039 / 045 /
047 / 050 already closed InstanceRef, always-mode fan-out, budget telemetry, and
`retry_count` — this plan does not re-author them.

## Technical Approach

### Seams

| Seam | Path | Change |
| --- | --- | --- |
| Accumulation helpers | `packages/opencode/src/session/budget-consume.ts` | Optional retrieval + validation fields on `ConsumptionDelta`; fold in `accumulateConsumption`; `retrievalDelta` / `validationDelta`; per-turn retrieval view in `evaluateLiveBudget` |
| Narrowing record | `packages/opencode/src/session/prompt.ts` | After live `narrowForTurn`, when routing enforcement is active, record a retrieval-only delta from kept agents/skills/tools + auto-skill chunks |
| Validation record | `packages/opencode/src/tool/task.ts` | On `validationPerformed: true` in foldWorkerTerminal, record `validationDelta(1)` on the **parent** session |
| Tests | `packages/opencode/test/session/budget-consume.test.ts` | Accumulation, per-turn retrieval shape, validation count, no-throw |

### Algorithms

1. **Retrieval delta construction (pure).** From `NarrowedSets`:  
   `retrievalChunks = |agents| + |skills| + |tools|` (kept ids when present),  
   `rerankChunks = |tools|` when tools surface ran,  
   `skillChunks = |chunks|`,  
   `skillTokens = skillChunks * conservative per-chunk token estimate` (or 0 if no chunks).  
   Zero when all surfaces absent (passthrough / gates-off).

2. **Accumulation.** Same `recordTurn` path: prior `?? ZERO_CONSUMPTION`, fold delta,
   `store.recordConsumption`. Omitted optional fields ⇒ 0 (byte-identical pre-055).

3. **Evaluation shape.** `evaluateLiveBudget` builds a per-turn retrieval view
   (current delta's retrieval fields) for `checkRetrievalConsumption`; resilience
   and cost stay cumulative; limits stay per-response for token ceilings.

4. **Activation / safety.** Reuse Feature 043 gate where session-budget aware
   (`enforcementActive`); hang/crash-safe wrap on record sites (defect → no-op).

### Out of plan

- Operator payloads, DEFAULT_ROUTING_BUDGET table, elevating `escalation` to hard-stop.
- Re-implementing 039/045/047/050.

## Companion Artifacts

- CUE: `doc/arch/schemas/wire-budget-phase-3-retrieval-and-resilience-consumption.cue`
- Gherkin: `doc/arch/specs/features/wire-budget-phase-3-retrieval-and-resilience-consumption.feature`
- ADR-0055 (accepted decisions above)
