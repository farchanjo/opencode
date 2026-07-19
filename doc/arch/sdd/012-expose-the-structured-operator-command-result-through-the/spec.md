---
id: 019f79f2-65a6-7d22-a33b-7a0f1668cc78
number: 012
slug: expose-the-structured-operator-command-result-through-the
status: implemented
created_at: 2026-07-19T10:35:56.710724Z
---
# Feature Specification: Expose the Structured Operator Command Result Through the TUI

Feature: 012-expose-the-structured-operator-command-result-through-the
Created: 2026-07-19
Scope: TUI consumption of the Feature 007 typed operator result. This feature
threads the already-typed `CommandResult.effective` payload from the inbound TUI
adapter through the TUI context and dispatch helper into the five read panels and
the entity pickers, and adds a real Dialog back-stack primitive. It owns no
dispatch, auth, audit, or domain business logic and adds no new command path.
Feature 007 remains the command/query authority and the parity invariant is
preserved; Feature 011 owns the grouped navigation this feature feeds.

## Problem

Feature 007 already produces a **typed structured result**. The `CommandResult`
envelope (`packages/core/src/operator/envelope.ts:54-65`, `kind
operator.admin_result`) carries an optional `effective` field, and `successResult`
places the domain's typed payload (the same `@opencode-ai/protocol` shapes the
panels consume) into it. The slash interceptor already returns both halves:
`{ result: CommandResult; display: OperatorSlashDisplay }`
(`packages/opencode/src/operator/adapters/inbound/slash.ts:51-52`).

The structured half is **dropped at every TUI-facing inbound seam**. There are
**three** inbound slash-port adapters that build the outbound object from the
**display fields plus `currentVersion` only** — `result.result.effective` is never
forwarded:

- `packages/opencode/src/operator/adapters/inbound/tui-port.ts` — the local
  in-process interceptor path (test/embedded stack).
- `packages/opencode/src/operator/adapters/inbound/rpc-slash-port.ts` — the
  DEFAULT `opencode tui` path via `wireLocalOperatorSlashPort` →
  `createWorkerRpcSlashPort` (worker RPC).
- `packages/opencode/src/operator/adapters/inbound/http-slash-port.ts` — the
  remote/attach path via `createHttpOperatorSlashPort` (Operator SDK/HTTP).

All three parse the typed `CommandResult` (including its `effective`) and then
discard the structured half in their `displayHandled` helpers, so everything
downstream is display-only:

1. **Context is display-only.** `OperatorSlashHandled`
   (`packages/tui/src/context/operator-slash.tsx:22-28`) exposes `display`,
   `needsConfirmation`, and `currentVersion` — no `effective`, no typed
   `outcome`. `executeOperatorCommand` (`packages/tui/src/operator/execute.ts`)
   returns only `{ outcome?: string; cancelled?: boolean }` derived from the
   display string.
2. **Read panels render honest-empty forever.** The five built panels — jobs,
   langlock, output, semantic, mcp — each consume a typed `*PanelSignal`
   (`JobsPanelSignal` `.../jobs/state.ts:16`; `LangLockPanelSignal`
   `.../langlock/state.ts:16`; `OutputPanelSignal` `.../output/state.ts:33`;
   `SemanticPanelSignal` `.../semantic/state.ts:17`; `McpPanelSignal`
   `.../mcp/state.ts:48`), all composed of the same protocol types the domains
   emit as `effective`. Feature 011 wired `DialogOperatorReadPanel` with the
   `signal` prop omitted, so every panel falls back to its `EMPTY_*_SIGNAL`
   baseline — not because the data is unavailable, but because it is dropped one
   layer up (Feature 011 plan T013 evidence).
3. **Entity pickers open empty.** The Configure forms for `jobs.enable`,
   `jobs.disable`, `jobs.delete`, `jobs.run-now` (→ `jobDefinitionId`),
   `process.cancel` (→ `processId`), and `task.cancel` (→ `taskId`) open with
   `NO_OPTIONS` (`packages/tui/src/operator/form/descriptor.ts:80-85`) because no
   read query result is reachable; the operator cannot pick the entity to act on.
4. **No real back stack.** `packages/tui/src/ui/dialog.tsx` has an internal stack
   whose `escape`/`ctrl+c` binding pops one level (lines 118/132), but the public
   API exposes only `clear`/`replace`/`stack`/`size`/`setSize` (lines 139-175);
   `replace` resets to a single-element stack. Feature 011 operator navigation
   therefore used `ctx.replace` plus a manual back affordance (Feature 011 plan
   implementation notes), with no real Home → domain → panel back stack.

The fix is a **consumption change only**: forward the payload Feature 007 already
produces, thread it to the panels and pickers that already accept its shape, and
add the ~5-line Dialog `push` primitive the navigation needs. No new dispatch
path, no backend change, no new command name.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Live read panels

- As an operator, I want a View verb (for example `langlock.show` or `jobs.list`)
  to render its **live** effective state in the corresponding read panel, so that
  the panel shows the real configured/observed data instead of always-empty rows.
- As an operator, I want a panel whose backend read is unavailable, or whose
  result carries no `effective` payload, to fall back to its honest empty state,
  so that the UI never invents rows.

### P1 — Populated entity pickers

- As an operator, I want a Configure verb that acts on an entity (a job
  definition, a process, a task) to open its picker populated from the
  corresponding read query, so that I can select the real entity to act on
  instead of facing an empty list.

### P1 — Honest availability

- As an operator, I want a picker or panel whose read backend is not reachable
  today to show its honest empty state without implying that data was fetched, so
  that the UI stays truthful about what is wired.

### P2 — Real back navigation

- As an operator, I want Home → domain → panel/form navigation to unwind one
  level per `escape`, so that leaving a panel returns me to the domain menu rather
  than closing the whole dialog or relying on a manual affordance.

## Functional Requirements

1. **Forward the structured result at every TUI-facing inbound seam (FR1).** The
   `TuiOperatorSlashPort.tryHandle` return MUST forward the typed `outcome`, the
   optional `effective` payload, and the `version` from the `CommandResult`
   alongside the existing `display` and `currentVersion` fields. This applies to
   **all three** inbound slash-port adapters that implement `TuiOperatorSlashPort`
   — `tui-port.ts` (local interceptor), `rpc-slash-port.ts` (default worker-RPC
   `opencode tui` path), and `http-slash-port.ts` (remote/attach) — with
   byte-identical display fields preserved and identical structured semantics
   (`outcome`; `effective` only when defined; `version ?? null`). This is a
   widening of the SAME `tryHandle` return object on the SAME dispatch path — no
   new method, route, or command name is introduced. These three inbound adapters
   are the only files under `packages/opencode/src/operator/**` this feature may
   touch.
2. **Extend the TUI handled result (FR2).** `OperatorSlashHandled`
   (`packages/tui/src/context/operator-slash.tsx`) MUST carry an **optional**
   structured result — the typed `outcome`, an optional `effective` payload, and
   the `version` — kept structurally separate from the human `display`. Absence of
   `effective` MUST be representable and MUST NOT be an error.
3. **Thread the structured result through dispatch (FR3).** `executeOperatorCommand`
   (`packages/tui/src/operator/execute.ts`) MUST return the structured result
   (typed `outcome`, optional `effective`, `version`) to its callers in addition to
   the existing display-derived `outcome`/`cancelled`. The dispatch path itself is
   unchanged (FR9).
4. **Per-domain projection functions (FR4).** For each of the five read domains —
   `jobs`, `langlock`, `output`, `semantic`, `mcp` — a pure projection function
   MUST map an `effective` payload to that domain's typed `*PanelSignal`. Each
   projection MUST validate the payload shape and, on any mismatch or missing
   field, MUST return the domain's honest `EMPTY_*_SIGNAL` — it MUST NEVER throw,
   crash the panel, or synthesize partial rows. A projection outcome is exactly one
   of `projected` (a valid effective payload), `empty_fallback` (no effective
   payload / unavailable envelope), or `shape_mismatch` (effective present but not
   the expected shape → treated as empty).
5. **Feed the live signal into the read panels (FR5).** `DialogOperatorReadPanel`
   MUST feed the projected `*PanelSignal` into its panel, replacing Feature 011's
   always-omitted `signal` wiring. When the projection outcome is `empty_fallback`
   or `shape_mismatch`, the panel MUST render its documented `EMPTY_*_SIGNAL`
   baseline. Selecting a View verb MUST dispatch no mutation. The panel-mount read is
   **auto-issued** and MUST be toast-silent (including on error/unavailable): the
   panel's honesty is its empty state, not a toast; only user-invoked commands raise
   toasts.
6. **Populate entity pickers from read queries (FR6).** The entity-picker option
   loaders MUST issue the corresponding read query through the SAME
   `executeOperatorCommand` path and project its `effective` payload into picker
   options: `jobs.enable`/`disable`/`delete`/`run-now` load from `jobs.list`
   (→ `jobDefinitionId`); `process.cancel` loads from `process.tree`
   (→ `processId`); `task.cancel` loads from `task.tree` (→ `taskId`). When the
   read returns no `effective` payload or a typed unavailable envelope, the loader
   MUST return an empty option set and the picker MUST render its honest empty view
   (never a fabricated candidate). The option `value` is always the entity id from
   the payload, never a command id or free-form text. The picker-loader read is
   **auto-issued** and MUST be toast-silent (including on the `invalid_argument`
   returned by the process/task tree reads today): the honest empty picker is the
   surface, not a toast.
7. **Dialog back-stack primitive and adoption (FR7).** `packages/tui/src/ui/dialog.tsx`
   MUST expose a `push(input, onClose?)` primitive that appends a level to the
   internal stack instead of resetting it, complementing `replace`. Operator
   navigation (`dialog-settings.tsx`) MUST adopt `push` for Home → domain →
   panel/form descent so the existing `escape`/`ctrl+c` pop (lines 118/132) unwinds
   exactly one level, replacing the Feature 011 `replace`-plus-manual-affordance
   pattern. `dialog.tsx` is a genuinely-new in-scope path for this feature.
8. **Honest availability everywhere (FR8, CRITICAL).** A panel or picker MUST light
   up ONLY when its read backend returns a typed `effective` payload today.
   Concretely: `langlock` reads and `jobs.list`/`jobs.status` return `effective`
   and populate; `output`, `semantic`, and `mcp` reads remain honest-unavailable
   until their backends land (a later backend feature); an entity read that returns a typed
   `unavailable`/`not_implemented` envelope or omits `effective` MUST fall back to
   the honest `EMPTY_*_SIGNAL` / empty picker. The UI MUST NEVER fabricate data,
   synthesize a success, or imply a fetch that did not occur.
9. **Parity invariant preserved (FR9, from Feature 007 FR8).** The structured
   result MUST ride the SAME `OperatorSlashPort.tryHandle` return on the SAME
   `OperatorClient` loopback as slash and CLI; command IDs are unchanged and no new
   dispatch path, parallel registry, or divergent command name is introduced. No
   backend behavior changes: `packages/opencode/src/operator/**` is off-limits
   except the three inbound TUI slash-port adapters (`tui-port.ts`,
   `rpc-slash-port.ts`, `http-slash-port.ts`), which only widen their handled
   return with the already-parsed structured result (FR1).

## Non-Functional Requirements

- **Pure projections.** The five projection functions and the picker option
  projections MUST be pure (no I/O, no solid-js), safe to recompute on every
  render, mirroring the existing `*/state.ts` modules.
- **No new flag.** The operator control plane stays behind
  `OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`,
  unchanged. This feature adds no new flag.
- **No i18n layer.** Consistent with Feature 011; this feature adds no translation
  pipeline.
- **Bounded rendering.** Projections MUST respect the existing per-panel row
  bounds (e.g. `MAX_VISIBLE_*` in the panel state modules); a large effective
  payload MUST NOT render unbounded rows.

## Acceptance Scenarios

Given the operator control plane flag is enabled

- **Render a live langlock view.**
  Given the `langlock` domain panel is open,
  When the operator selects `langlock.show`,
  Then the langlock read panel renders the effective policy/allowlist state from
  the structured result, not the empty baseline, and no mutation is dispatched.

- **Fall back to honest-empty on unavailable read.**
  Given a domain whose read backend is not implemented (for example `semantic`),
  When the operator opens its read panel,
  Then the panel renders its `EMPTY_*_SIGNAL` baseline and the UI does not imply
  that any data was fetched.

- **Fall back on shape mismatch (never crash).**
  Given a read whose `effective` payload does not match the expected panel shape,
  When the projection runs,
  Then it returns the honest empty signal and the panel renders without throwing.

- **Populate a jobs entity picker.**
  Given the `jobs` Configure section,
  When the operator selects `jobs.delete`,
  Then the picker loads job-definition options projected from a `jobs.list` read
  through the same dispatch path, and the selected `jobDefinitionId` is the entity
  id from the payload.

- **Empty picker when the entity read is unavailable.**
  Given `process.cancel` when `process.tree` returns no `effective` payload,
  When the picker opens,
  Then it renders its honest empty view with no fabricated candidate.

- **Back navigation unwinds one level.**
  Given Home → `jobs` domain → a read panel opened via `push`,
  When the operator presses `escape`,
  Then exactly one level is popped and the `jobs` domain panel is shown, not a
  closed dialog.

## Security Requirements

- **Data sensitivity/classification.** This feature is TUI consumption of the
  Feature 007 typed result; the `effective` payload is already the bounded,
  redacted, versioned operator-surface projection each domain emits. The
  projections MUST NOT widen, re-resolve, or de-redact it; they only reshape the
  already-redacted payload into the panel signal the panel already accepts.
- **Authentication/authorization.** No new authenticated surface. The structured
  result rides the same `OperatorClient` loopback and operator principal, scope,
  version/CAS, and confirmation gates as slash/CLI (Feature 007 FR4, FR19); the TUI
  is a thin consumer and cannot relax those gates. Read queries issued by the
  picker loaders (`jobs.list`, `process.tree`, `task.tree`) are read-only and
  dispatch no mutation.
- **Input validation.** The untrusted input this feature parses is the `effective`
  payload arriving from the dispatch boundary. Each projection MUST treat it as
  unknown, validate its shape defensively, and fall back to the honest empty signal
  on any mismatch rather than trusting or partially rendering it. Picker option
  values are taken only from validated entity ids, never constructed from
  free-form text.
- **Cryptography in transit/at rest.** Not applicable — dispatch is loopback-only
  and this feature persists nothing; Feature 007 owns persistence and secret
  backends.
- **Logging/audit.** This feature writes no new log or audit channel. Audit remains
  the Feature 007 EventV2 record produced by the underlying dispatch; the TUI adds
  no transcript entry and injects no content into the session.
- **Error-handling information exposure.** A malformed or unavailable `effective`
  payload degrades to the honest empty signal; the projections MUST NOT surface raw
  payload fragments, stack traces, or path detail in a panel, picker, or toast. The
  typed `unavailable`/`not_implemented` outcome is surfaced only as the existing
  bounded display state.

## Projection Model

The structured result and its projections are specified as ValueObjects in
`doc/arch/schemas/operator-result-signal/` and as a statechart in
`doc/arch/statecharts/operator-result-projection.md`:

```
StructuredHandledResult(outcome, effective?, version?)
  -> PanelProjection(domain, outcome ∈ {projected | empty_fallback | shape_mismatch})
       -> *PanelSignal            (projected: typed effective → panel signal)
       -> EMPTY_*_SIGNAL          (empty_fallback / shape_mismatch: honest baseline)
  -> PickerProjection(source ∈ {jobs | process | task}, state ∈ {loaded | empty | unavailable})
       -> PickerOptionList        (loaded: entity ids projected from the read payload)
       -> empty option set        (empty / unavailable: honest empty picker)
```

## Observability

This feature emits no new telemetry of its own. Operator dispatches continue to
project through the Feature 007 EventV2 audit and the ADR-0001 OTLP foundation
with content-free, bounded labels (command/query id, source, scope, outcome). The
projection and picker loaders carry no request-scoped identifiers beyond what the
underlying dispatch already records; no effective payload, entity id, or verb
label is exported. Conventions live in `doc/arch/observability/observability.md`.

## Out of Scope

- Landing the `output`, `semantic`, or `mcp` read backends, or the `jobs`
  mutation backends — they stay honest-unavailable here (a later backend feature).
- Any new dispatch path, parallel registry, or divergent command name.
- Backend changes under `packages/opencode/src/operator/**` other than the three
  inbound TUI slash-port adapters (`tui-port.ts`, `rpc-slash-port.ts`,
  `http-slash-port.ts`) widening their handled return (FR1).
- App/Desktop parity (Feature 007 Phase 2).
- A new feature flag or an i18n/translation layer.

## Related Features and Decisions

- [ADR-0012 — Expose the structured operator command result through the TUI](../../adr/0012-expose-the-structured-operator-command-result-through-the.md)
- [Feature 011 Restructure the Operator Control Plane TUI](../011-restructure-the-operator-control-plane-tui-from-a-flat/spec.md) — grouped navigation, editable forms, honest availability; this feature feeds its panels and pickers.
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — command/query authority, typed `CommandResult.effective`, parity invariant.
- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md)
- [Projection schema](../../schemas/operator-result-signal/projection.cue)
- [Projection statechart](../../statecharts/operator-result-projection.md)

## Clarifications
