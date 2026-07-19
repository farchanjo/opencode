# Tasks: Restructure the Operator Control Plane TUI From a Flat List (Feature 011)

Synced with plan.md (Phase 1 core copy/metadata, Phase 2 navigation, Phase 3
editable forms, Phase 4 read panels, Phase 5 tests + doc sync) and the
specScopeGlobs in doc/arch/speckit.toml. ADR-0011 proposed.

Presentation and navigation only. NO new dispatch path, NO backend change, NO new
flag — the Feature 007 `OperatorClient` loopback parity invariant (FR8) is
preserved. No code is executed in this documentary pass; tasks are the implement
backlog. All items start unchecked.

Legend:

- `[P]` — may run in parallel with other `[P]` tasks that share no overlapping paths
- `Depends:` — task IDs that must complete first
- Verification — acceptance checks for the task
- Evidence — filled during implement (date + file:line + test result)

## Task Breakdown

Checkbox backlog (details under each group below).

- [ ] T001 — Static persisting-domains + availability map in `palette.ts`
- [ ] T002 — Per-verb input-mode descriptor map in `palette.ts`
- [ ] T003 — Normative label copy (view/configure/confirm/unavailable/secret)
- [ ] T004 — Extend `OPERATOR_SETTINGS_DOMAINS` from 8 to 12
- [ ] T005 — Keep curated `suggest` subset; drop the flat wall from the projection
- [ ] T006 — Group-list + domain-panel projection builders (`#GroupList`/`#DomainPanel`)
- [ ] T007 — Collapse the flat spread in `app.tsx` to one `Operator` entry
- [ ] T008 — Home group list of 12 domains with availability badges
- [ ] T009 — Domain panel View/Configure split with confirm/secret markers
- [ ] T010 — Generalise `DialogLangLockPicker` into a reusable operator form
- [ ] T011 — Wire persisting-domain Configure verbs to the form + payload dispatch
- [ ] T012 — Direct dispatch for no-payload verbs; honest-unavailable envelope
- [ ] T013 — Wire the five read panels into their View section (honest-empty fallback)
- [ ] T014 — Unit tests: palette metadata, normative copy, 12 domains
- [ ] T015 — Unit/integration tests: navigation, form dispatch, honest-unavailable
- [ ] T016 — Parity test: palette/form dispatch same command id as slash/CLI (FR8)
- [ ] T017 — Doc sync + `speckit validate` green

---

## Group A — Core palette metadata and copy (`palette.ts`)

- [ ] **T001 — Static persisting-domains + availability map**
- **Depends:** none
- **[P]** with T002
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** static map `{langlock, jobs, routing, process, task} = persists_today`,
  all other domain mutations `honest_unavailable`; derive `#VerbAvailability`
  (`available` | `confirm_required` | `unavailable`) per verb from
  `mutates` + `requiresConfirmation` + persistence class.
- **Acceptance:** honest-unavailable mutation → `unavailable`; persisting
  confirm-required mutation → `confirm_required`; persisting plain mutation and
  read-only query → `available`.
- **Verification:** unit assertions on the derived availability for a sample per class.
- **Evidence:**

- [ ] **T002 — Per-verb input-mode descriptor map**
- **Depends:** none
- **[P]** with T001
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** static descriptor map assigning `#InputMode`
  (`none` | `value_picker` | `text_input`) to the persisting Configure verbs —
  `langlock`(`set`,`reset`), `jobs`(`create`,`update`,`enable`,`disable`,`delete`,
  `reschedule`,`run-now`), `routing`(`configure`), `process`(`cancel`,`steer`,
  `handoff`), `task`(`cancel`); every other verb stays `none`.
- **Acceptance:** listed verbs report their input mode; verbs with no payload → `none`.
- **Verification:** unit snapshot of the input-mode map.
- **Evidence:**

- [ ] **T003 — Normative label copy**
- **Depends:** T001
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** replace `titleFor` / the `"Operator query|mutation: <id>"` ternary
  with the verbatim spec copy — top entry `Operator` / `Grouped operator settings and
  views`; domain row `{Available|Partial|Unavailable} · {view_count} views ·
  {configure_count} settings`; view `View: {verbLabel}` / `Read-only view ·
  {commandId}`; configure `Configure: {verbLabel}` / `Editable setting · {commandId}`
  (+ `· confirm required`); unavailable `Unavailable · not implemented yet ·
  {commandId}`; secret rows append ` · secret`. Dotted id stays in the subtitle, never
  the primary label.
- **Acceptance:** each row class renders its exact copy; no `"Operator query: <id>"`
  string remains; secret suffix present only for `isOperatorSecretMutationId` verbs.
- **Verification:** unit string assertions matching `operator-menu/text-values.cue`.
- **Evidence:**

- [ ] **T004 — Extend `OPERATOR_SETTINGS_DOMAINS` from 8 to 12**
- **Depends:** none
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** add `process`, `task`, `jobs`, `output` so all 12 reserved domains
  project into the group menu (FR2).
- **Acceptance:** `OPERATOR_SETTINGS_DOMAINS.length === 12`; the four added domains
  return their verbs from `listOperatorSettingsEntries`.
- **Verification:** unit assertion on domain count + membership.
- **Evidence:**

- [ ] **T005 — Curated `suggest` subset; drop the flat wall from the projection**
- **Depends:** T003
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** keep `listOperatorSuggestedEntries()` (read-only `status`/`show`)
  as the only top-level quick-access set; ensure the projection no longer expects the
  full flat entry list at top level (FR1).
- **Acceptance:** suggested set is read-only queries only; full flat wall not surfaced
  as top-level commands.
- **Verification:** unit assertion suggested ⊆ read-only queries.
- **Evidence:**

- [ ] **T006 — Group-list + domain-panel projection builders**
- **Depends:** T001, T002, T003, T004
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** builders assembling the `#GroupList` (12 `#DomainGroup` rows with
  badge, `view_count`, `configure_count`) and the per-domain `#DomainPanel`
  (`view`/`configure` `#VerbList`) matching `operator-menu/navigation.cue`.
- **Acceptance:** each domain group carries correct counts + badge; panel splits verbs
  by `mutates` into View/Configure.
- **Verification:** unit assertion of one representative domain projection.
- **Evidence:**

---

## Group B — TUI navigation (`app.tsx` + `dialog-settings.tsx`)

- [ ] **T007 — Collapse the flat spread to one `Operator` entry**
- **Depends:** T005
- **Paths:** `packages/tui/src/app.tsx`
- **Deliverable:** remove the unconditional `listOperatorPaletteEntries()` top-level
  spread; register exactly ONE `Operator` palette entry that opens
  `DialogOperatorSettingsHome`; the curated `suggest` set MAY remain (FR1).
- **Acceptance:** exactly one top-level operator entry; no per-verb rows at top level.
- **Verification:** integration assertion on the top-level command set.
- **Evidence:**

- [ ] **T008 — Home group list of 12 domains with badges**
- **Depends:** T006, T007
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** `DialogOperatorSettingsHome` renders the `#GroupList` — 12 rows,
  each with human label + availability-badge subtitle; `domain_selected` pushes the
  domain panel via `ctx.push` (FR2).
- **Acceptance:** home shows 12 rows with badges; selecting one pushes `domain_panel`.
- **Verification:** integration assertion on the home node.
- **Evidence:**

- [ ] **T009 — Domain panel View/Configure split with markers**
- **Depends:** T008
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** `DialogOperatorDomainPanel` renders the `view` and `configure`
  `#VerbList`s as two labelled sections; confirm-required and secret markers baked into
  each subtitle; row selection routes per `#VerbAvailability`/`#InputMode`
  (view→result/panel; confirm→`DialogConfirm`; input→form; unavailable→result) (FR3).
- **Acceptance:** both sections present; markers shown; routing matches the statechart.
- **Verification:** integration assertion on a domain with both sections.
- **Evidence:**

---

## Group C — Editable configuration forms

- [ ] **T010 — Generalise `DialogLangLockPicker` into a reusable operator form**
- **Depends:** T002
- **Paths:** `packages/tui/src/operator/form/**`
- **Deliverable:** extract the value-picker + text-input pattern from
  `packages/tui/src/settings/langlock/index.tsx` into a form component driven by the
  per-verb `#InputMode` descriptors; it collects a typed payload and calls
  `executeOperatorCommand({ ..., payload })` — the SAME dispatch path (FR5, FR8).
- **Acceptance:** `value_picker` and `text_input` modes both collect and emit a payload;
  form never builds a command id/scope from free text; no secret rendered/echoed.
- **Verification:** unit assertion on collected payload shape per mode.
- **Evidence:**

- [ ] **T011 — Wire persisting-domain Configure verbs to the form**
- **Depends:** T009, T010
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`, `packages/tui/src/operator/form/**`
- **Deliverable:** route `langlock.set`/`reset`, the `jobs` mutations,
  `routing.configure`, `process.cancel`/`steer`/`handoff`, `task.cancel` through the
  form; confirm-required verbs pass through `DialogConfirm` after payload collection
  (FR5).
- **Acceptance:** selected persisting Configure verb opens the form and dispatches the
  collected payload; change persists with a version + audit via Feature 007.
- **Verification:** integration assertion that dispatch carries the payload.
- **Evidence:**

- [ ] **T012 — Direct dispatch for no-payload verbs; honest-unavailable envelope**
- **Depends:** T009, T011
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`, `packages/tui/src/operator/execute.ts`
- **Deliverable:** verbs with `#InputMode=none` dispatch directly (through
  `DialogConfirm` first when confirm-required); honest-unavailable verbs invoke the
  command and surface the typed `unavailable`/`not_implemented` envelope in the result
  toast without synthesizing success (FR7). No change to `executeOperatorCommand`'s
  dispatch path.
- **Acceptance:** no-payload verb dispatches without a form; unavailable verb shows the
  typed envelope; UI never implies persistence.
- **Verification:** integration assertion on an unavailable verb outcome.
- **Evidence:**

---

## Group D — Read-side panel wiring

- [ ] **T013 — Wire the five read panels into their View section**
- **Depends:** T009
- **Paths:** `packages/tui/src/operator/{jobs,output,langlock,semantic,mcp}/index.tsx`,
  `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** wire the built `jobs`/`output`/`langlock`/`semantic`/`mcp` panels
  into their domain panel's View section, fed by the operator result signal; fall back
  to each panel's honest-empty baseline (`EMPTY_*_SIGNAL`) when no signal is present;
  no mutation on a view selection (FR6).
- **Acceptance:** each panel renders effective state from the signal, or its honest
  empty state; selecting a view verb dispatches no mutation.
- **Verification:** integration assertion on one panel with and without a signal.
- **Evidence:**

---

## Group E — Tests and doc sync

- [ ] **T014 — Unit tests: palette metadata, normative copy, 12 domains**
- **Depends:** T006
- **Paths:** `packages/core/test/operator/**`
- **Deliverable:** assert the normative copy for every row class
  (view/configure/confirm/unavailable/secret), the 12-domain
  `OPERATOR_SETTINGS_DOMAINS`, the `#GroupList` badge + counts, and the static
  availability/input-mode maps; update/remove any test asserting the old
  `"Operator query: <id>"` copy or the flat entry set.
- **Acceptance:** suite green; no assertion of the retired copy or flat wall remains.
- **Verification:** `bun test test/operator` (core) green.
- **Evidence:**

- [ ] **T015 — Unit/integration tests: navigation, form dispatch, honest-unavailable**
- **Depends:** T012, T013
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert one top-level `Operator` entry with no flat per-verb rows;
  home lists 12 domains; the View/Configure split with markers; the form collects and
  dispatches the payload through the same path; an unavailable verb surfaces the typed
  envelope with no synthesized success.
- **Acceptance:** suite green across navigation, form, and honest-unavailable cases.
- **Verification:** `bun test` (tui) green.
- **Evidence:**

- [ ] **T016 — Parity test: palette/form dispatch same command id as slash/CLI**
- **Depends:** T011
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert the palette/form dispatch resolves the SAME canonical command
  id through the SAME `OperatorClient` loopback as slash/CLI, introducing no new
  dispatch path, parallel registry, or divergent name (FR8).
- **Acceptance:** command id parity holds for one query and one mutation; no new path.
- **Verification:** integration/parity assertion green.
- **Evidence:**

- [ ] **T017 — Doc sync + `speckit validate` green**
- **Depends:** T014, T015, T016
- **Paths:** docs under allowed globs (spec, ADR-0011, `operator-menu/*.cue`,
  `operator-menu-navigation.md`; `AGENTS.md`/`README.md` only if a surface description
  drifts)
- **Deliverable:** reconcile the shipped copy and node names with the spec, ADR, schema,
  and statechart; run `speckit analyze` and `speckit validate --json` clean of new
  Feature 011 findings.
- **Acceptance:** `speckit validate --json` → 0 new findings on Feature 011 artifacts;
  `speckit status` completeness ok.
- **Verification:** `speckit analyze` + `speckit validate --json`.
- **Evidence:**

---

## Dependencies summary

```
(T001 ∥ T002 ∥ T004) → T003 → T005
T001+T002+T003+T004 → T006
T005 → T007 → T008 (needs T006) → T009
T002 → T010 ; T009+T010 → T011 → T012
T009 → T013
T006 → T014 ; T012+T013 → T015 ; T011 → T016
T014+T015+T016 → T017
```

## Parallelism rules

- Only `[P]` tasks may run concurrently, and only when path sets do not overlap.
- Never parallelize two tasks writing the same module (`palette.ts`,
  `dialog-settings.tsx`).
- Group A (core `palette.ts`) precedes the TUI groups that consume its projection.

## Task counts

| Group                     | Tasks             | Phase |
| ------------------------- | ----------------- | ----- |
| A Core palette metadata   | T001–T006 (6)     | 1     |
| B TUI navigation          | T007–T009 (3)     | 2     |
| C Editable forms          | T010–T012 (3)     | 3     |
| D Read panels             | T013 (1)          | 4     |
| E Tests + doc sync        | T014–T017 (4)     | 5     |
| **Total actionable**      | **T001–T017 (17)** |      |

## Definition of done

- FR1–FR8 covered; the flat wall removed, 12 domains grouped, View/Configure split.
- Persisting-domain Configure verbs dispatch a real payload through the form.
- The five read panels render from the signal with honest-empty fallback.
- Honest-unavailable verbs surface the typed envelope; no synthesized success.
- No new dispatch path, registry, divergent name, or feature flag (FR8 parity).
- Palette metadata copy matches the spec + `operator-menu/text-values.cue`.
- Test suites green; `speckit validate --json` clean of new Feature 011 findings.
