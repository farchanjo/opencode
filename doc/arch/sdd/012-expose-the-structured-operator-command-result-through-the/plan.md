# Implementation Plan: Expose the Structured Operator Command Result Through the TUI

Feature: 012-expose-the-structured-operator-command-result-through-the
Status target: planned (after this plan is complete)
ADR: [ADR-0012](../../adr/0012-expose-the-structured-operator-command-result-through-the.md) **proposed**
Spec: [spec.md](spec.md) (FR1-FR9; projection model; honest-availability invariant)

## Overview

Feature 007 delivered the unified native Operator Control Plane, including a typed
`CommandResult` envelope whose optional `effective` field already carries the
domain's typed payload (the same `@opencode-ai/protocol` shapes the TUI read panels
consume). Feature 011 restructured the TUI into grouped navigation with editable
forms and honest availability, but could reach no structured signal: the payload is
**dropped at one seam** (`packages/opencode/src/operator/adapters/inbound/tui-port.ts:114-135`
forwards display fields plus `currentVersion` only), so the five read panels render
their `EMPTY_*_SIGNAL` baseline forever and the entity pickers open with
`NO_OPTIONS`.

This plan is a **consumption-only** change over the unchanged Feature 007 dispatch:
forward the already-typed `outcome`/`effective`/`version` across the inbound adapter
seam, thread it through the TUI context and dispatch helper, project it per domain
into the existing panel signals and picker options, feed the live signal into the
panels, populate the entity pickers from their read queries, and add the ~5-line
Dialog `push` primitive the navigation needs. Honest availability is preserved
everywhere: a panel or picker lights up only when a typed `effective` payload is
present today; everything else degrades to the honest empty signal.

**Explicitly out of this plan (invariants preserved):**

- **No new dispatch path (Feature 007 parity, FR9).** The structured result rides
  the SAME `OperatorSlashPort.tryHandle` return through the SAME `OperatorClient`
  loopback as slash/CLI — no parallel registry, divergent name, or new route.
- **No backend behavior change.** Only the inbound adapter `tui-port.ts` is touched
  under `packages/opencode/src/operator/**`; the rest of the operator backend is
  off-limits.
- **No new command id.** Command IDs are unchanged; the picker read queries
  (`jobs.list`, `process.tree`, `task.tree`) are existing catalog verbs.
- **No control-plane flag change.** The surface stays behind
  `OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`.
- **No i18n layer.** Consistent with Feature 011.
- **No fabricated data (FR8).** `output`, `semantic`, and `mcp` reads stay
  honest-unavailable until a later backend feature; the projections never synthesize rows.

## Technical Approach

### Architecture layers affected

```
Backend inbound adapter (packages/opencode/src/operator/adapters/inbound/tui-port.ts)
  tryHandle return  ── widened with ──▶  { outcome, effective?, version } (FR1)
        │  (SAME return object; SAME OperatorClient loopback; no new route)
        ▼
TUI context (packages/tui/src/context/operator-slash.tsx)
  OperatorSlashHandled ── gains optional ──▶ structured result (FR2)
        ▼
TUI dispatch (packages/tui/src/operator/execute.ts)
  executeOperatorCommand ── returns ──▶ structured result to callers (FR3)
        │
        ├─ per-domain projection (packages/tui/src/operator/{jobs,langlock,output,semantic,mcp}/state.ts)
        │     effective ──▶ *PanelSignal | EMPTY_*_SIGNAL   (FR4)
        │        ▼
        │  DialogOperatorReadPanel (dialog-settings.tsx) feeds the live signal (FR5)
        │
        └─ picker option loader (packages/tui/src/operator/form/descriptor.ts + form/index.tsx)
              jobs.list / process.tree / task.tree ──▶ PickerOptionList | empty (FR6)

Navigation primitive (packages/tui/src/ui/dialog.tsx)
  push(input, onClose?) appends a stack level; escape pops one (FR7)
```

The typed `CommandResult.effective` (`packages/core/src/operator/envelope.ts:54-65`)
and the five `*PanelSignal` types are the single source the projection reads; the
projection ValueObjects are specified in `doc/arch/schemas/operator-result-signal/`
and the statechart in `doc/arch/statecharts/operator-result-projection.md`.

### Phase 1 — Forward the structured result at the inbound seam (FR1)

- **Widen `tui-port.ts` `tryHandle`.** In the handled branch (lines 114-135), add
  the typed `outcome`, the optional `effective` payload, and the `version` from
  `result.result` to the returned object, alongside the existing `display` and
  `currentVersion`. This is a pure widening of the SAME return object — no new
  method, route, or command name. `tui-port.ts` is the inbound adapter and the ONLY
  operator-backend file this feature touches (FR9).
- **Keep the type contract in sync.** Update the `TuiOperatorSlashPort` return type
  so the widened fields are typed at the boundary; the effective payload stays
  `Unknown`/opaque at this layer (it is projected downstream, FR4).

### Phase 2 — Thread the structured result through the TUI (FR2, FR3)

- **Extend `OperatorSlashHandled`** (`packages/tui/src/context/operator-slash.tsx`)
  with an optional structured result — the typed `outcome`, an optional `effective`
  payload (`unknown`), and the `version` — kept structurally separate from the human
  `display`. Absence of `effective` is representable and is not an error (FR2).
- **Return it from `executeOperatorCommand`** (`packages/tui/src/operator/execute.ts`).
  Widen the return type from `{ outcome?; cancelled? }` to also carry the structured
  result; populate it from `first.handled`/`second.handled`/`result.handled` on
  every handled branch. The dispatch path itself (preflight, idempotency key,
  confirm gate) is unchanged (FR9).

### Phase 3 — Per-domain projection functions (FR4)

- **Add a pure `project*Signal(effective: unknown): *PanelSignal` per domain** in
  the existing `packages/tui/src/operator/{jobs,langlock,output,semantic,mcp}/state.ts`
  modules (they already own `EMPTY_*_SIGNAL` and the signal type). Each:
  - validates the payload shape defensively (treat `effective` as unknown);
  - on a valid shape returns the typed `*PanelSignal` (`projected`);
  - on absent `effective` / a typed unavailable envelope returns `EMPTY_*_SIGNAL`
    (`empty_fallback`);
  - on a present-but-mismatched shape returns `EMPTY_*_SIGNAL` (`shape_mismatch`);
  - NEVER throws, and respects the existing `MAX_VISIBLE_*` row bounds.
- The projection outcome (`projected | empty_fallback | shape_mismatch`) matches
  `operator-result-signal/enums.cue` `#ProjectionOutcome`.

### Phase 4 — Feed the live signal into the read panels (FR5)

- **`DialogOperatorReadPanel`** (`packages/tui/src/operator/dialog-settings.tsx`)
  takes the structured result from the read-verb dispatch, runs the domain
  projection, and passes the resulting `*PanelSignal` into the panel via its
  `signal` prop — replacing Feature 011's always-omitted wiring. On
  `empty_fallback`/`shape_mismatch` the panel renders its documented baseline. A
  view selection dispatches no mutation (FR5, FR8).

### Phase 5 — Populate entity pickers from read queries (FR6)

- **Loader per entity picker** in `packages/tui/src/operator/form/`
  (`descriptor.ts` + `index.tsx`). Replace the `NO_OPTIONS` stub for the entity
  pickers with a loader that issues the corresponding read query through the SAME
  `executeOperatorCommand` path and projects the `effective` payload into
  `#PickerOption`s keyed by the entity id:
  - `jobs.enable`/`disable`/`delete`/`run-now` → `jobs.list` (→ `jobDefinitionId`);
  - `process.cancel` → `process.tree` (→ `processId`);
  - `task.cancel` → `task.tree` (→ `taskId`).
- On no `effective` / a typed unavailable envelope the loader returns an empty
  option set and the picker renders its honest empty view (`state ∈ {empty,
  unavailable}`); no candidate is fabricated. The option `value` is only ever the
  validated entity id, never a command id or free-form text (FR6, FR8, Security).

### Phase 6 — Dialog back-stack primitive and adoption (FR7)

- **Add `push(input, onClose?)`** to `packages/tui/src/ui/dialog.tsx` public API: it
  appends `{ element, onClose }` to `store.stack` instead of resetting it (the
  `escape`/`ctrl+c` binding at lines 118/132 already pops one level). `replace`
  stays for root/reset use.
- **Adopt `push` in operator navigation** (`dialog-settings.tsx`): Home → domain →
  panel/form descends via `push`, so `escape` unwinds exactly one level, retiring
  Feature 011's `replace`-plus-manual-affordance pattern (recorded in the Feature
  011 plan implementation notes).

### Phase 7 — Tests + doc sync

- **Unit — projections (`packages/tui/test/operator/**`).** For each of the five
  domains assert: a valid `effective` payload projects to the typed `*PanelSignal`
  (`projected`); an absent payload / typed unavailable envelope yields
  `EMPTY_*_SIGNAL` (`empty_fallback`); a malformed payload yields `EMPTY_*_SIGNAL`
  without throwing (`shape_mismatch`).
- **Unit — picker loaders.** Assert `jobs.list`/`process.tree`/`task.tree` results
  project into options keyed by the entity id, and that an unavailable/empty read
  yields the honest empty option set.
- **Integration — forward + thread.** Assert the widened `tui-port.ts` return
  carries `outcome`/`effective`/`version`, that `OperatorSlashHandled` and
  `executeOperatorCommand` surface them, and that a live langlock/jobs read renders
  a populated panel while an unavailable read renders the baseline.
- **Integration — navigation back stack.** Assert `push` appends a level and
  `escape` pops exactly one (Home → domain → panel returns to domain).
- **Parity (FR9).** Reuse the Feature 007 parity harness to assert the structured
  result rides the same command id / same loopback as slash/CLI, with no new
  dispatch path.
- **Doc sync.** Keep the spec, ADR-0012, the projection schema, and the statechart
  in sync with the shipped shapes; refresh `AGENTS.md`/`README.md` only if a
  user-facing surface description drifts.

## Data model and migration strategy

None. This feature persists nothing and introduces no table or store; Feature 007
owns persistence, CAS, idempotency, and the EventV2 audit. The projection is a pure
transform over the typed `CommandResult.effective`, typed by the ValueObjects in
`doc/arch/schemas/operator-result-signal/` (`#StructuredHandledResult`,
`#PanelProjection`, `#ProjectionList`, `#PickerOption`, `#PickerProjection`) and the
bounded enums (`#ResultOutcome`, `#ProjectionDomain`, `#ProjectionOutcome`,
`#PickerSource`, `#PickerState`).

## Projection state machine

Per `doc/arch/statecharts/operator-result-projection.md`:

```
dispatched → forwarded            (effective_forwarded | effective_absent)
forwarded → { projected | empty_fallback | shape_mismatch }   (project_panel)
  projected      → panel_rendered (domain *PanelSignal)
  empty_fallback → panel_rendered (EMPTY_*_SIGNAL baseline)
  shape_mismatch → panel_rendered (EMPTY_*_SIGNAL baseline)
forwarded → { loaded | empty | unavailable }                  (load_entity_options)
  loaded      → picker_rendered   (entity ids projected into options)
  empty       → picker_rendered   (empty option set)
  unavailable → picker_rendered   (empty option set)
```

Both projections consume a result produced by the same command id through the same
`OperatorClient` loopback as slash/CLI (FR9). Every projection is total — it never
throws and never fabricates rows (FR4, FR6, FR8).

## Security and threat boundaries

| Concern                      | Mitigation                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| No new authenticated surface | The structured result rides the Feature 007 `OperatorClient` loopback + operator principal (FR9).     |
| Input validation             | `effective` is treated as unknown; each projection validates the shape and degrades to empty on fail. |
| No de-redaction              | `effective` is the already-redacted operator-surface projection; projections reshape, never widen.    |
| No fabricated data (FR8)     | Absent/unavailable/mismatched reads render the honest empty signal; no synthesized rows or success.   |
| No secret leakage            | Picker option values are validated entity ids only; no raw payload fragment surfaces in a toast.      |
| No new audit/log channel     | Audit stays the Feature 007 EventV2 record; the TUI adds no transcript entry or session injection.    |

## Observability

No new telemetry. Dispatches continue to project through the Feature 007 EventV2
audit and the ADR-0001 OTLP foundation with content-free, bounded labels
(command/query id, source, scope, outcome). The projections and picker loaders carry
no request-scoped identifiers beyond what the underlying dispatch already records; no
effective payload, entity id, or verb label is exported.

## specScopeGlobs (applied in doc/arch/speckit.toml)

Narrow paths only; most of the implementation surface is already in scope under the
Feature 007 / 011 blocks. Two paths are genuinely new to Feature 012 (the TUI
context type and the Dialog primitive); reused seams are listed for traceability:

```toml
# Genuinely new to Feature 012:
"packages/tui/src/context/**",              # OperatorSlashHandled structured result (FR2)
"packages/tui/src/ui/dialog.tsx",           # push back-stack primitive (FR7)
# Already in scope (Feature 007 / 011 / 001) — NOT re-added, listed for traceability:
#   packages/opencode/src/operator/**        → tui-port.ts inbound forward (FR1)
#   packages/tui/src/**/operator/**          → execute.ts, dialog-settings.tsx, form/**, five {domain}/state.ts (FR3-FR6)
#   packages/tui/test/**                     → projection/loader/forward/navigation/parity tests (Phase 7)
```

Source of truth: `doc/arch/speckit.toml` `[guard].specScopeGlobs`.

## Implementation order (task groups preview)

1. Forward the structured result at the inbound seam (`tui-port.ts`).
2. Thread it through the TUI context + dispatch (`operator-slash.tsx`, `execute.ts`).
3. Five per-domain projection functions (`{domain}/state.ts`).
4. Feed the live signal into the read panels; entity picker loaders.
5. Dialog `push` primitive + navigation adoption.
6. Tests (projection, loader, forward/thread, navigation, parity) + doc sync.

## Companion artifacts

None required beyond this plan. The projection ValueObjects
(`doc/arch/schemas/operator-result-signal/`) and the statechart
(`doc/arch/statecharts/operator-result-projection.md`) already carry the data
model; no `research.md`, `data-model.md`, `contracts/`, or `quickstart.md` is added.

## Validation checklist (plan complete when)

- [x] FR1-FR9 mapped to ordered phases
- [x] No new dispatch path / no backend behavior change / no new command id / no flag
- [x] Only `tui-port.ts` touched under the operator backend (FR1, FR9)
- [x] Five projections total (projected | empty_fallback | shape_mismatch), never throw
- [x] Entity picker loaders issue existing read verbs on the same path (FR6)
- [x] Dialog `push` primitive + operator navigation adoption (FR7)
- [x] Honest availability everywhere; no fabricated data (FR8)
- [x] specScopeGlobs narrow; only `context/**` + `ui/dialog.tsx` genuinely new
- [x] Security: input validation, no de-redaction, no fabricated data, parity
- [ ] `tasks.md` generated and filled
- [ ] `speckit analyze` clean of new Critical/High/Medium blockers
- [ ] `speckit validate --json` green (0 new findings on Feature 012 artifacts)
