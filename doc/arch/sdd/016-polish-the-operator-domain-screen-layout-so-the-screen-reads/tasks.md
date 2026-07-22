# Tasks: Polish The Operator Domain Screen Layout So The Screen Reads (Feature 016)

Synced with plan.md (Phase 1 header-first order, Phase 2 compact status, Phase 3
row copy contract, Phase 4 section ordering + entity-first affordances, Phase 5
tests + doc sync) and the specScopeGlobs in doc/arch/speckit.toml. ADR-0016
proposed.

Presentation-and-copy ONLY. NO new catalog id, NO catalog version bump, NO new
dispatch path, NO new flag, NO new dialog primitive, NO new statechart — the
Feature 007 registration + `OperatorClient` loopback parity invariant (FR6) is
preserved and behavior stays governed by the Feature 015 statechart. Every screen
action dispatches the SAME command id through the SAME `executeOperatorCommand`
path; an unavailable verb (the Feature 014 per-verb `Partial` truth) stays marked +
inert, never a fabricated success. `packages/opencode` stays read-only. No code is
executed in this documentary pass; tasks are the implement backlog. All items start
unchecked.

## Task Breakdown

Checkbox backlog (details under each group below).

- [x] T001 — Move the inline status inside the `DialogSelect` layout (header-first order)
- [x] T002 — Assert the header → status → search → action list reading order
- [x] T003 — Project per-group status state (populated/empty/loading/unavailable) in `status.ts`
- [x] T004 — Render compact status: populated in full, empty collapsed to one summary line
- [x] T005 — Drop the row boilerplate; id secondary only when it fits without truncation
- [x] T006 — Drop the per-row kind badge; section header alone carries the kind
- [x] T007 — Availability marker on a row only when the verb is not fully available
- [x] T008 — Order Configure before View for editable domains (centralised in `palette.ts`)
- [x] T009 — Entity-first Configure affordances: create + list as the first Configure rows
- [x] T010 — Compact-status tests (populated full, empty summary line, honest states kept)
- [x] T011 — Row copy tests (no boilerplate, no kind badge, id-when-fits, marker-when-not-available)
- [x] T012 — Ordering + affordance tests (Configure-before-View; Add server/Create job/Add provider first)
- [x] T013 — Parity + honest-availability re-assert (same id, no new path/id/version/flag/statechart)
- [x] T014 — Guard scope confirm (no new `speckit.toml` glob) + doc sync; `analyze` + `validate --json` green

---

## Group A — Header-first reading order (FR1)

- [x] **T001 — Move the inline status inside the `DialogSelect` layout** `[P]`
- **Depends:** none
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`, `packages/tui/src/ui/dialog.tsx`
- **Deliverable:** in `DialogOperatorDomainPanel`, stop rendering
  `<OperatorStatusSection>` in the outer `<box>` above `<DialogSelect>`; render it
  below the header **inside** the dialog by passing it through the existing
  `titleView`/header content slot (the slot `DialogOperatorSettingsHome` already
  uses for its subtitle) so the panel reads header → status → search → action list
  (FR1). If no below-header slot is wide enough, extend the existing `DialogSelect`
  `titleView`/header content prop (presentation only) — add NO new dialog primitive.
- **Acceptance:** the status section renders below the `Operator · <Domain>` header
  and above the search/list; it never renders above the header.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

- [x] **T002 — Assert the header → status → search → action list reading order**
- **Depends:** T001
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** a screen-composition test asserting the domain screen renders the
  header first, the inline status second, the search third, and the action list
  fourth — pinning that the status is not above the header (FR1).
- **Acceptance:** the ordering assertion passes for a plain domain and for a rich
  domain (mcp).
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

## Group B — Compact status with collapsed empty groups (FR2)

- [x] **T003 — Project per-group status state in `status.ts`** `[P]`
- **Depends:** none
- **Paths:** `packages/tui/src/operator/status.ts`, `packages/core/test/operator/**`
- **Deliverable:** extend the `status.ts` projection so each status group exposes
  whether it is `populated`, `empty`, `loading`, or `unavailable` (mirroring
  `operator-screen-layout` `#StatusGroupState`), keeping the projection total and
  side-effect free (an absent/non-record payload → honest empty), and bounded
  (`MAX_STATUS_NODES`). No secret or raw payload is widened (FR2).
- **Acceptance:** the projection reports the correct state per group for a
  populated, an empty, and an absent payload.
- **Verification:** `bun test packages/core/test/operator/**` (or the status test).
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

- [x] **T004 — Render compact status: populated in full, empty collapsed to one line**
- **Depends:** T003
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** in `OperatorStatusSection`/`StatusKeyValue`, render the
  **populated** groups in full and collapse the **empty** groups to a **single**
  summary line naming them (`servers · resources · experimental · calls: empty`);
  keep `Loading…` and `unavailable` explicit and never collapse them; render no
  summary line when all groups are populated and only the line when none is (FR2).
- **Acceptance:** an all-empty status renders one summary line; a mixed status
  renders the populated groups plus the empty summary; a loading read renders the
  honest `Loading…` text.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

## Group C — Row copy contract (FR3)

- [x] **T005 — Drop the row boilerplate; id secondary only when it fits** `[P]`
- **Depends:** none
- **Paths:** `packages/core/src/operator/palette.ts`, `packages/core/test/operator/**`
- **Deliverable:** rewrite `verbSubtitleFor` so the row secondary line is the dotted
  command id **only when it fits without truncation**, dropping the
  `Read-only view ·`/`Editable setting ·` prefix; when the id would truncate
  mid-token, omit the secondary line rather than truncate. Keep the id discoverable
  where it fits, never as the primary label (FR3).
- **Acceptance:** a row whose id fits shows the id secondary line; a row whose id
  would truncate shows none; no row carries the `Read-only view ·` prefix.
- **Verification:** `bun test packages/core/test/operator/**`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

- [x] **T006 — Drop the per-row kind badge; section header alone carries the kind**
- **Depends:** none
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** remove the per-row `view`/`configure` kind footer from
  `verbFooter`/`verbOption` so the row carries no kind badge; the section header
  (the `View`/`Configure`/`Settings` category the `DialogSelect` groups rows under)
  alone carries the kind (FR3).
- **Acceptance:** no action row renders a `view`/`configure` kind footer badge; the
  section header still distinguishes View from Configure.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

- [x] **T007 — Availability marker on a row only when the verb is not fully available**
- **Depends:** T006
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`, `packages/core/src/operator/palette.ts`
- **Deliverable:** keep the `unavailable`/`confirm`/`secret` marker on a row **only
  when the verb is not fully available**, derived from the Feature 014 per-verb
  availability; a fully-available verb renders no marker (FR3, FR6).
- **Acceptance:** a fully-available verb row carries no marker; an unavailable /
  confirm-required / secret verb row carries its marker.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

## Group D — Section ordering + entity-first affordances (FR4, FR5)

- [x] **T008 — Order Configure before View for editable domains** `[P]`
- **Depends:** none
- **Paths:** `packages/core/src/operator/palette.ts`, `packages/tui/src/operator/dialog-settings.tsx`, `packages/core/test/operator/**`
- **Deliverable:** centralise the section order in the `palette.ts` panel projection
  so a domain with editable (Configure) state orders **Configure before View**, and
  a pure read-only domain keeps View leading; update the `dialog-settings.tsx`
  `options()` composition to consume the ordered projection rather than open-coding
  the order (FR4).
- **Acceptance:** an editable domain (mcp/telemetry/jobs) renders Configure first; a
  read-only domain keeps View first; the order lives in `palette.ts`.
- **Verification:** `bun test packages/core/test/operator/**`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

- [x] **T009 — Entity-first Configure affordances: create + list as the first rows**
- **Depends:** T008
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`, `packages/tui/src/operator/entity.ts`
- **Deliverable:** replace the single generic `Manage <collection>` entity row with
  the entity domain's **create + list** affordance as the **first** Configure rows —
  `mcp` → `Add server` + `Servers`; `jobs` → `Create job` + `Jobs`; `semantic` →
  `Add provider` + providers/models — where `Add server`/`Create job`/`Add provider`
  open the existing Feature 015 create flow and `Servers`/`Jobs`/lists open the
  existing list→item CRUD screen, through the same `entity.ts` `createId`/`listRead`
  ids and loopback (FR5, FR6).
- **Acceptance:** the mcp screen leads Configure with `Add server` + `Servers`; jobs
  with `Create job` + `Jobs`; semantic with `Add provider` + the lists; each opens
  the existing create/CRUD screen with no new command id.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

## Group E — Tests + invariants + doc sync (FR6, FR7)

- [x] **T010 — Compact-status tests**
- **Depends:** T004
- **Paths:** `packages/tui/test/operator/**`, `packages/core/test/operator/**`
- **Deliverable:** tests asserting populated groups render in full, empty groups
  collapse to one summary line, and honest `Loading`/`unavailable` states stay
  explicit and uncollapsed (FR2).
- **Acceptance:** the compact-status assertions pass.
- **Verification:** `bun test packages/tui/test/operator/** packages/core/test/operator/**`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

- [x] **T011 — Row copy tests**
- **Depends:** T005, T006, T007
- **Paths:** `packages/core/test/operator/**`, `packages/tui/test/operator/**`
- **Deliverable:** tests asserting the `Read-only view ·` boilerplate and the
  per-row kind badge are gone, the id secondary line appears only when untruncated,
  and the availability marker appears only when the verb is not fully available
  (FR3).
- **Acceptance:** the row copy assertions pass.
- **Verification:** `bun test packages/core/test/operator/** packages/tui/test/operator/**`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

- [x] **T012 — Ordering + affordance tests**
- **Depends:** T008, T009
- **Paths:** `packages/core/test/operator/**`, `packages/tui/test/operator/**`
- **Deliverable:** tests asserting Configure orders before View for editable domains
  and the entity domains lead with `Add server`+`Servers` / `Create job`+`Jobs` /
  `Add provider`+lists over the existing command ids (FR4, FR5).
- **Acceptance:** the ordering + affordance assertions pass.
- **Verification:** `bun test packages/core/test/operator/** packages/tui/test/operator/**`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

- [x] **T013 — Parity + honest-availability re-assert**
- **Depends:** T009
- **Paths:** `packages/core/test/operator/**`, `packages/tui/test/operator/**`
- **Deliverable:** re-assert (reusing the Feature 007/015 parity harness) that every
  screen action rides the same command id through the same loopback with no new
  dispatch path, no new catalog id, no catalog version bump, no new flag, and no new
  statechart, and that an unavailable verb stays marked + inert (FR6).
- **Acceptance:** the parity + honest-availability assertions pass; no catalog id or
  version changed.
- **Verification:** `bun test packages/core/test/operator/** packages/tui/test/operator/**`; `bun run typecheck`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

- [x] **T014 — Guard scope confirm + doc sync + analyze/validate**
- **Depends:** T001-T013
- **Paths:** `doc/arch/speckit.toml` (read-only confirm), `doc/arch/sdd/016-*/`, `doc/arch/adr/0016-*.md`, `doc/arch/schemas/operator-screen-layout/**`, `AGENTS.md`, `README.md`
- **Deliverable:** confirm the touched surface is fully covered by the existing
  Feature 007/011/012 `speckit.toml` guard globs (`packages/tui/src/**/operator/**`,
  `packages/core/src/operator/**`, `packages/tui/src/ui/dialog.tsx`,
  `packages/tui/test/**`, `packages/core/test/operator/**`) — no genuinely-new
  implement path, so no guard change; keep the spec, ADR-0016, and the
  `operator-screen-layout/*.cue` corpus in sync with the shipped shapes; refresh
  `AGENTS.md`/`README.md` only if a user-facing surface description drifts. Run
  `speckit analyze` and `speckit validate --json` green (FR6, FR7).
- **Acceptance:** `speckit analyze` reports no new blockers; `speckit validate
  --json` is `ok:true` with 0 new findings on Feature 016 artifacts.
- **Verification:** `speckit analyze`; `speckit validate --json`.
- **Evidence:** 2026-07-19 — implemented (see plan.md "Implementation notes (2026-07-19)"). core operator 111 pass, tui operator 147 pass, full tui 471 pass / 0 fail; core+tui `typecheck` + `oxlint` clean on touched files; `speckit validate --json` ok:true (0 new findings), `speckit analyze` consistent.

## Dependencies

- **Upstream (all landed):** Feature 015 (CRUD composition, entity screens, modals,
  `status.ts` projection), Feature 014 (per-verb availability), Feature 012 (result
  signal + Dialog push/back-stack), Feature 011 (grouped projection), Feature 007
  (`executeOperatorCommand`/`OperatorClient` loopback, registration authority).
- **Guard scope:** the entire touched surface is already covered by the Feature
  007/011/012 `speckit.toml` blocks — no new glob required (confirmed in T014).
- **No external systems, backends, or catalog changes** — presentation-and-copy only.

## Parallelization

- T001 (order), T003 (status projection), T005 (subtitle copy), T008 (section order)
  touch distinct seams and may start in parallel `[P]`.
- T006/T007 (row footer/marker) share `dialog-settings.tsx` with T001/T004 — serialize
  the `dialog-settings.tsx` edits.
- The test tasks (T002, T010-T013) follow their implementation tasks; T014 is last.
