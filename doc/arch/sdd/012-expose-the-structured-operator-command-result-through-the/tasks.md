# Tasks: Expose the Structured Operator Command Result Through the TUI (Feature 012)

Synced with plan.md (Phase 1 forward seam, Phase 2 context/dispatch thread, Phase 3
per-domain projections, Phase 4 panel feed, Phase 5 picker loaders, Phase 6 Dialog
push, Phase 7 tests + doc sync) and the specScopeGlobs in doc/arch/speckit.toml.
ADR-0012 proposed.

Consumption ONLY. NO new dispatch path, NO backend behavior change, NO new command
id, NO new flag — the Feature 007 `OperatorClient` loopback parity invariant (FR9)
is preserved; only the inbound adapter `tui-port.ts` is touched under the operator
backend. No code is executed in this documentary pass; tasks are the implement
backlog. All items start unchecked.

Legend:

- `[P]` — may run in parallel with other `[P]` tasks that share no overlapping paths
- `Depends:` — task IDs that must complete first
- Verification — acceptance checks for the task
- Evidence — filled during implement (date + file:line + test result)

## Task Breakdown

Checkbox backlog (details under each group below).

- [ ] T001 — Forward `outcome`/`effective`/`version` on the `tui-port.ts` tryHandle return
- [ ] T002 — Extend `OperatorSlashHandled` with an optional structured result
- [ ] T003 — Return the structured result from `executeOperatorCommand`
- [ ] T004 — `projectLangLockSignal` — effective → `LangLockPanelSignal` | empty
- [ ] T005 — `projectJobsSignal` — effective → `JobsPanelSignal` | empty
- [ ] T006 — `projectOutputSignal` — effective → `OutputPanelSignal` | empty
- [ ] T007 — `projectSemanticSignal` — effective → `SemanticPanelSignal` | empty
- [ ] T008 — `projectMcpSignal` — effective → `McpPanelSignal` | empty
- [ ] T009 — Feed the projected signal into `DialogOperatorReadPanel`
- [ ] T010 — Jobs entity-picker loader from `jobs.list` (jobDefinitionId)
- [ ] T011 — Process/task entity-picker loaders from `process.tree`/`task.tree`
- [ ] T012 — Dialog `push(input, onClose?)` back-stack primitive
- [ ] T013 — Adopt `push` in operator navigation (Home → domain → panel/form)
- [ ] T014 — Unit tests: five projections (projected / empty_fallback / shape_mismatch)
- [ ] T015 — Unit tests: picker loaders (loaded / empty / unavailable)
- [ ] T016 — Integration tests: forward+thread, live panel, navigation back stack
- [ ] T017 — Parity test: structured result rides same command id as slash/CLI (FR9)
- [ ] T018 — Doc sync + `speckit validate` green

---

## Group A — Forward and thread the structured result

- [ ] **T001 — Forward `outcome`/`effective`/`version` at the inbound seam**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/adapters/inbound/tui-port.ts`
- **Deliverable:** in the handled branch (currently lines 114-135) add the typed
  `outcome`, the optional `effective` payload, and the `version` from
  `result.result` to the returned object, alongside the existing `display` and
  `currentVersion`; update the `TuiOperatorSlashPort` return type to match. A pure
  widening of the SAME return object — no new method, route, or command name (FR1,
  FR9). This is the ONLY operator-backend file this feature touches.
- **Acceptance:** the return carries `outcome` + optional `effective` + `version`;
  no new dispatch path or command id is introduced.
- **Verification:** unit assertion on the widened return shape for a success result
  carrying `effective`.
- **Evidence:**

- [ ] **T002 — Extend `OperatorSlashHandled` with an optional structured result**
- **Depends:** T001
- **Paths:** `packages/tui/src/context/operator-slash.tsx`
- **Deliverable:** add an optional structured result to `OperatorSlashHandled` — the
  typed `outcome`, an optional `effective` payload (`unknown`), and the `version` —
  kept structurally separate from `display`. Absence of `effective` is representable
  and is not an error (FR2). Mirror the type on `OperatorSlashPort`.
- **Acceptance:** `OperatorSlashHandled` carries the optional structured fields; a
  handled result with no `effective` type-checks.
- **Verification:** typecheck + unit assertion on a handled result with and without
  `effective`.
- **Evidence:**

- [ ] **T003 — Return the structured result from `executeOperatorCommand`**
- **Depends:** T002
- **Paths:** `packages/tui/src/operator/execute.ts`
- **Deliverable:** widen the return type from `{ outcome?; cancelled? }` to also
  carry the structured result (typed `outcome`, optional `effective`, `version`);
  populate it from `first`/`second`/`result` on every handled branch. The dispatch
  path (preflight, idempotency key, confirm gate) is unchanged (FR3, FR9).
- **Acceptance:** callers receive the structured result on a handled dispatch; the
  dispatch path is byte-for-byte unchanged.
- **Verification:** unit assertion that a handled read dispatch returns the
  structured result.
- **Evidence:**

---

## Group B — Per-domain projection functions (FR4)

- [ ] **T004 — `projectLangLockSignal`**
- **Depends:** T003
- **[P]** with T005, T006, T007, T008
- **Paths:** `packages/tui/src/operator/langlock/state.ts`
- **Deliverable:** pure `projectLangLockSignal(effective: unknown): LangLockPanelSignal`
  — valid shape → typed signal (`projected`); absent/unavailable → `EMPTY_LANGLOCK_SIGNAL`
  (`empty_fallback`); mismatched shape → `EMPTY_LANGLOCK_SIGNAL` (`shape_mismatch`);
  never throws; respects existing row bounds (FR4, FR8).
- **Acceptance:** the three outcomes resolve as specified; malformed input does not
  throw.
- **Verification:** unit assertions per outcome.
- **Evidence:**

- [ ] **T005 — `projectJobsSignal`**
- **Depends:** T003
- **[P]** with T004, T006, T007, T008
- **Paths:** `packages/tui/src/operator/jobs/state.ts`
- **Deliverable:** pure `projectJobsSignal(effective: unknown): JobsPanelSignal` over
  `JobDefinitionSummary`/`Occurrence`/`NotificationEnvelope`; same three-outcome
  contract and `MAX_VISIBLE_*` bounds as T004 (FR4, FR8).
- **Acceptance:** valid `jobs.list` payload projects definitions/occurrences/
  notifications; absent/mismatched → `EMPTY_JOBS_PANEL_SIGNAL`; never throws.
- **Verification:** unit assertions per outcome.
- **Evidence:**

- [ ] **T006 — `projectOutputSignal`**
- **Depends:** T003
- **[P]** with T004, T005, T007, T008
- **Paths:** `packages/tui/src/operator/output/state.ts`
- **Deliverable:** pure `projectOutputSignal(effective: unknown): OutputPanelSignal`;
  same three-outcome contract (FR4, FR8). `output` reads are honest-unavailable
  today (FR8), so the runtime path resolves to `empty_fallback` until a later backend feature —
  the projection is written total regardless.
- **Acceptance:** three outcomes resolve; unavailable read → `EMPTY_OUTPUT_SIGNAL`;
  never throws.
- **Verification:** unit assertions per outcome.
- **Evidence:**

- [ ] **T007 — `projectSemanticSignal`**
- **Depends:** T003
- **[P]** with T004, T005, T006, T008
- **Paths:** `packages/tui/src/operator/semantic/state.ts`
- **Deliverable:** pure `projectSemanticSignal(effective: unknown): SemanticPanelSignal`;
  same three-outcome contract (FR4, FR8). `semantic` reads honest-unavailable today
  → runtime `empty_fallback` until a later backend feature; projection written total.
- **Acceptance:** three outcomes resolve; unavailable read → `EMPTY_SEMANTIC_SIGNAL`;
  never throws.
- **Verification:** unit assertions per outcome.
- **Evidence:**

- [ ] **T008 — `projectMcpSignal`**
- **Depends:** T003
- **[P]** with T004, T005, T006, T007
- **Paths:** `packages/tui/src/operator/mcp/state.ts`
- **Deliverable:** pure `projectMcpSignal(effective: unknown): McpPanelSignal`; same
  three-outcome contract (FR4, FR8). `mcp` reads honest-unavailable today → runtime
  `empty_fallback` until a later backend feature; projection written total.
- **Acceptance:** three outcomes resolve; unavailable read → `EMPTY_MCP_SIGNAL`;
  never throws.
- **Verification:** unit assertions per outcome.
- **Evidence:**

---

## Group C — Feed panels and populate pickers

- [ ] **T009 — Feed the projected signal into `DialogOperatorReadPanel`**
- **Depends:** T004, T005, T006, T007, T008
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** `DialogOperatorReadPanel` takes the structured result from the
  read-verb dispatch, runs the domain projection, and passes the resulting
  `*PanelSignal` into the panel `signal` prop — replacing Feature 011's omitted
  wiring. `empty_fallback`/`shape_mismatch` → the panel's `EMPTY_*_SIGNAL` baseline;
  a view selection dispatches no mutation (FR5, FR8).
- **Acceptance:** a langlock/jobs read renders a populated panel; an unavailable
  read renders the baseline; no mutation on view.
- **Verification:** integration assertion on one panel with and without effective.
- **Evidence:**

- [ ] **T010 — Jobs entity-picker loader from `jobs.list`**
- **Depends:** T005, T009
- **Paths:** `packages/tui/src/operator/form/descriptor.ts`, `packages/tui/src/operator/form/index.tsx`
- **Deliverable:** replace `NO_OPTIONS` for `jobs.enable`/`disable`/`delete`/`run-now`
  with a loader that issues `jobs.list` through the SAME `executeOperatorCommand`
  path and projects the `effective` payload into `#PickerOption`s keyed by
  `jobDefinitionId`. No effective / unavailable → empty option set + honest empty
  picker; `value` is the entity id only, never a command id or free text (FR6, FR8).
- **Acceptance:** picker lists job definitions from `jobs.list`; unavailable read →
  empty picker; selected value is `jobDefinitionId`.
- **Verification:** integration assertion on the jobs picker loaded and empty.
- **Evidence:**

- [ ] **T011 — Process/task entity-picker loaders**
- **Depends:** T009, T010
- **Paths:** `packages/tui/src/operator/form/descriptor.ts`, `packages/tui/src/operator/form/index.tsx`
- **Deliverable:** loaders for `process.cancel` (from `process.tree` → `processId`)
  and `task.cancel` (from `task.tree` → `taskId`), same contract as T010: project
  the `effective` payload into options keyed by the entity id; no effective /
  unavailable → honest empty picker (FR6, FR8). Sequenced after T010 because both
  edit `form/descriptor.ts` + `form/index.tsx` (no parallel write).
- **Acceptance:** process/task pickers populate from their tree read when effective
  is present, else render honest-empty; value is `processId`/`taskId`.
- **Verification:** integration assertion on the process/task pickers loaded and
  empty.
- **Evidence:**

---

## Group D — Dialog back stack (FR7)

- [ ] **T012 — Dialog `push(input, onClose?)` primitive**
- **Depends:** none
- **[P]** with Group A/B (distinct file)
- **Paths:** `packages/tui/src/ui/dialog.tsx`
- **Deliverable:** add `push(input, onClose?)` to the public API — it appends
  `{ element, onClose }` to `store.stack` instead of resetting it (the `escape`/
  `ctrl+c` binding at lines 118/132 already pops one level); `replace` stays for
  root/reset use (FR7).
- **Acceptance:** `push` appends a level; the stack length grows by one; `escape`
  pops exactly one.
- **Verification:** unit assertion on stack length after push/pop.
- **Evidence:**

- [ ] **T013 — Adopt `push` in operator navigation**
- **Depends:** T009, T012
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** Home → domain → panel/form descends via `push` so `escape`
  unwinds exactly one level, retiring Feature 011's `replace`-plus-manual-affordance
  pattern (recorded in the Feature 011 plan implementation notes) (FR7).
- **Acceptance:** Home → domain → panel; `escape` returns to the domain panel, not a
  closed dialog.
- **Verification:** integration assertion on the back-navigation path.
- **Evidence:**

---

## Group E — Tests and doc sync

- [ ] **T014 — Unit tests: five projections**
- **Depends:** T004, T005, T006, T007, T008
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** for each of the five domains assert `projected` (valid effective
  → typed signal), `empty_fallback` (absent/unavailable → `EMPTY_*_SIGNAL`), and
  `shape_mismatch` (malformed → `EMPTY_*_SIGNAL`, no throw).
- **Acceptance:** suite green; each domain covers all three outcomes.
- **Verification:** `bun test` (tui) green.
- **Evidence:**

- [ ] **T015 — Unit tests: picker loaders**
- **Depends:** T010, T011
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert `jobs.list`/`process.tree`/`task.tree` results project into
  options keyed by the entity id (`loaded`), and that an unavailable/empty read
  yields the honest empty option set (`empty`/`unavailable`).
- **Acceptance:** suite green across loaded and empty/unavailable cases.
- **Verification:** `bun test` (tui) green.
- **Evidence:**

- [ ] **T016 — Integration tests: forward+thread, live panel, navigation back stack**
- **Depends:** T009, T013
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert the widened `tui-port.ts` return carries
  `outcome`/`effective`/`version`; that `OperatorSlashHandled` and
  `executeOperatorCommand` surface them; that a live langlock/jobs read renders a
  populated panel and an unavailable read renders the baseline; and that `push`
  appends a level while `escape` pops exactly one.
- **Acceptance:** suite green across forward/thread, live-panel, and back-stack cases.
- **Verification:** `bun test` (tui) green.
- **Evidence:**

- [ ] **T017 — Parity test: same command id as slash/CLI (FR9)**
- **Depends:** T003
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** reuse the Feature 007 parity harness to assert the structured
  result rides the SAME canonical command id through the SAME `OperatorClient`
  loopback as slash/CLI, introducing no new dispatch path, parallel registry, or
  divergent name (FR9).
- **Acceptance:** command id parity holds for one read and one mutation; no new path.
- **Verification:** parity assertion green.
- **Evidence:**

- [ ] **T018 — Doc sync + `speckit validate` green**
- **Depends:** T014, T015, T016, T017
- **Paths:** docs under allowed globs (spec, ADR-0012, `operator-result-signal/*.cue`,
  `operator-result-projection.md`; `AGENTS.md`/`README.md` only if a surface
  description drifts)
- **Deliverable:** reconcile the shipped shapes and node names with the spec, ADR,
  schema, and statechart; run `speckit analyze` and `speckit validate --json` clean
  of new Feature 012 findings.
- **Acceptance:** `speckit validate --json` → 0 new findings on Feature 012
  artifacts; `speckit status` completeness ok.
- **Verification:** `speckit analyze` + `speckit validate --json`.
- **Evidence:**

---

## Dependencies summary

```
T001 → T002 → T003
T003 → (T004 ∥ T005 ∥ T006 ∥ T007 ∥ T008)
T004+T005+T006+T007+T008 → T009
T005+T009 → T010 → T011
T012 → T013 (needs T009)
T004..T008 → T014 ; T010+T011 → T015 ; T009+T013 → T016 ; T003 → T017
T014+T015+T016+T017 → T018
```

## Parallelism rules

- Only `[P]` tasks may run concurrently, and only when path sets do not overlap.
- The five projection tasks (T004-T008) touch five distinct `state.ts` modules and
  are safely parallel; T010/T011 both touch `form/**` and are sequenced.
- T012 (`ui/dialog.tsx`) is a distinct file and may run alongside Group A/B.
- Never parallelize two tasks writing the same module (`dialog-settings.tsx`,
  `form/descriptor.ts`).

## Task counts

| Group                        | Tasks              | Phase |
| ---------------------------- | ------------------ | ----- |
| A Forward + thread           | T001–T003 (3)      | 1-2   |
| B Per-domain projections     | T004–T008 (5)      | 3     |
| C Panel feed + pickers       | T009–T011 (3)      | 4-5   |
| D Dialog back stack          | T012–T013 (2)      | 6     |
| E Tests + doc sync           | T014–T018 (5)      | 7     |
| **Total actionable**         | **T001–T018 (18)** |       |

## Definition of done

- FR1–FR9 covered; the structured result forwarded at the seam and threaded to the
  panels and pickers.
- Five total projections (projected | empty_fallback | shape_mismatch) that never
  throw and never fabricate rows.
- Entity pickers populate from their read queries; honest-empty when unavailable.
- Dialog `push` primitive added and adopted; `escape` pops one level.
- Honest availability everywhere; no fabricated data or synthesized success (FR8).
- No new dispatch path, registry, divergent command id, or feature flag (FR9); only
  `tui-port.ts` touched under the operator backend.
- Test suites green; `speckit validate --json` clean of new Feature 012 findings.
