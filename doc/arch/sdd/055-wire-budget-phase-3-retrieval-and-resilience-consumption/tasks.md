# Tasks: Wire Budget Phase 3 Retrieval And Resilience Consumption

Synced with plan.md. ADR-0055 proposed/accepted. Feature 043 accumulation path
is the SSOT; no operator contract change.

## Task Breakdown

- [x] T001 Extend `ConsumptionDelta` + `accumulateConsumption` with optional
  retrieval and validation fields; add `retrievalDelta` / `validationDelta`
  helpers (omitted fields ⇒ 0, byte-identical pre-055).
  Paths: `packages/opencode/src/session/budget-consume.ts`
- [x] T002 Per-turn retrieval evaluation view in `evaluateLiveBudget` so
  `checkRetrievalConsumption` uses the current turn's retrieval delta (not the
  cumulative sum); resilience stays cumulative.
  Paths: `packages/opencode/src/session/budget-consume.ts`
  Depends: T001
- [x] T003 Record retrieval spend after live `narrowForTurn` in `prompt.ts` when
  Smart Routing enforcement is active; hang/crash-safe no-op on defect.
  Paths: `packages/opencode/src/session/prompt.ts`
  Depends: T001
- [x] T004 Increment parent-session `validation_count` when worker domain
  validation runs (`validationPerformed: true`) in `tool/task.ts` fold path;
  hang/crash-safe.
  Paths: `packages/opencode/src/tool/task.ts`
  Depends: T001
- [x] T005 Unit tests: accumulation of new fields, per-turn retrieval breach
  shape (no multi-turn spurious block), validation count, omitted-fields
  identity, no-throw.
  Paths: `packages/opencode/test/session/budget-consume.test.ts`
  Depends: T001, T002
- [x] T006 Gates: `bun test test/session/budget-consume.test.ts` green;
  `bunx tsgo --noEmit -p packages/opencode/tsconfig.json` clean;
  `speckit validate --json` ok; `speckit analyze` then `speckit implement`;
  mark tasks done.

## Dependencies

- Feature 043 Phase 2b (recordTurn / evaluateLiveBudget / activation gate)
- Feature 050 FR12 (`retry_count` pattern for optional delta fields)
- Feature 051/052 (`narrowForTurn`, auto-skill chunks)
- Feature 044 worker validation chain (`validationPerformed`)
