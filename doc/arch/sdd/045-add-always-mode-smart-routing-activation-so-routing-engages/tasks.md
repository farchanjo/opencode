# Tasks: Add Always Mode Smart Routing Activation So Routing Engages

## Task Breakdown

- [x] T001 Add the hang-safe activation-mode reader and the pure seam decision to
  `routing-resolve.ts`: `createRoutingActivationReader` (bounded, triple-guarded,
  degrades to `"never"`), `shouldConsultRouting({explicitModel, hasPersistedModel,
  mode})`, and the `readActivationMode`/`boundMode` helpers. Flip the routing gate
  (`:372`) from `mode === "auto"` to `mode !== "never"` and make the resolver read
  the mode first, memoizing (drift cache) ONLY under `auto` so `always`
  re-evaluates every turn (FR-A1, FR-A2, FR-A3, FR-C1, FR-D2). [routing-resolve.ts]
- [x] T002 Wire the re-evaluation seam into both `prompt.ts` model-selection paths
  (`createUserMessage` + shell path): build `readRoutingMode`, consult it only on a
  persisted-model turn with no explicit model, gate routing through
  `shouldConsultRouting`, and reorder precedence to
  `--model / agent-pinned ▶ routed ▶ selected ▶ static default`. Explicit model
  always wins in every mode (FR-A1, FR-B1, FR-D1). [prompt.ts]
- [x] T003 Reconcile the downstream mode gates so `always` is a strict superset of
  `auto`: `routing-hierarchy.ts:369` (F042 delegation) and `processor.ts:569` (F044
  Manager completion gate) move from `mode === "auto"` to `mode !== "never"`;
  confirm `processor.ts:53` (F043 budget) already admits `always` and document the
  now-converged gates (FR-C2, FR-C3, FR-C4). [routing-hierarchy.ts, processor.ts]
- [x] T004 Add isolated regression coverage
  (`test/session/routing-resolve.test.ts`, `test/session/routing-hierarchy.test.ts`):
  always re-evaluates every turn; auto still short-circuits; explicit model wins
  under always; disabled/never byte-identical; the reconciled F042 gate engages
  under always; the mode reader reads/collapses/degrades correctly; the always path
  inherits the hang-safety fallback (FR-D3). [tests]

## Dependencies

- Feature 037 (`routing-resolve.ts` resolver + hang-safety contract), Feature 042
  (`routing-hierarchy.ts` dispatch gate), Feature 043 (`processor.ts:53` budget
  gate), and Feature 044 (`processor.ts:569` completion gate) must be in place —
  all shipped. The `"always"` value already exists in `#RoutingMode`
  (`schemas/routing/config.cue`) and the operator picker, so no schema, enum, or
  operator-surface change is required.
