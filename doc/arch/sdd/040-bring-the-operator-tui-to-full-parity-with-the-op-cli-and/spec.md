---
id: 019f826f-2fc4-7e33-ab23-844f32f439ba
number: 040
slug: bring-the-operator-tui-to-full-parity-with-the-op-cli-and
status: analyzed
created_at: 2026-07-21T02:09:12.644297Z
---
# Feature Specification: Bring The Operator TUI To Full Parity With The op CLI

Feature: 040-bring-the-operator-tui-to-full-parity-with-the-op-cli-and
Created: 2026-07-21
Scope: the operator TUI multi-field Configure modals
(`packages/tui/src/operator/form/multi-field-modal.tsx#prefillFromRead`,
`form/field-list.ts` prefill mapping) and the config-backed `routing.status` READ they
prefill from (`packages/opencode/src/operator/adapters/outbound/config-status.ts#createRoutingStatusHandler`).
Feature 007 owns the operator control plane; Feature 017 built the multi-field prefill
(read-on-open → seed each field); Feature 024 wired `routing.configure` persistence;
Feature 034 added the explicit Request-scope selector; Feature 036 made the config-backed
`routing.status` read scope-aware; the smart/budget/pools effective read
(`routing/adapters/outbound/config-adapter.ts#resolveEffective`, consumed by
`operator/smart/backend-live.ts`) is the layered `project > global > default`
document-shadowing read the `op` CLI status surfaces report. This feature makes every
operator Configure modal PREFILL DYNAMICALLY from the persisted authority (`config.json`)
for the resolved scope — reaching full parity with what the `op` CLI reports — instead of
opening on static/blank defaults.

## The confirmed bug

With a persisted GLOBAL smart-routing activation (`global:routing`: `activation.enabled =
true`, `mode = auto`, `role_pools`, `budget`), the operator TUI "Routing configure" modal
opens on `Enabled [ ] off`, `Mode — select —`, and `Request scope = Project (this
directory)` — it does NOT reflect the persisted config. The modal DOES issue a read on
open and DOES carry per-field prefill functions, so the defect is neither "never reads"
nor "wrong widget": it is a COMPOUND read defect, both facets introduced when Feature 036
re-shadowed `routing.status`.

1. **Scope + single-authority read (does not shadow `global:routing`).** The
   `routing.configure` descriptor prefills from `readId: "routing.status"`
   (`field-list.ts:324`). That id is served by `createRoutingStatusHandler`
   (`config-status.ts:92-113`), which performs a SINGLE `config.get(authority)` where
   `authority = routingStatusAuthority(ctx.request.scope.kind)` — `global → global:routing`,
   every other kind → the project `routing` document (`config-status.ts:61-63`). The modal's
   prefill read (`multi-field-modal.tsx:202-221`) dispatches `executeOperatorCommand`
   WITHOUT `requestedScope`, so `ctx.request.scope.kind` is bare → the read resolves the
   PROJECT `routing` authority only. With only a `global:routing` document persisted, that
   authority is empty → `configured:false`, `activation:null`. It is a single `config.get`,
   NOT the layered `resolveEffective` (project > global > default) — so it never shadows the
   global activation the way `smart.status` does.

2. **Field-mapping / shape mismatch (prefill reads a shape the read no longer returns).**
   Feature 036 changed the `routing.status` effective SHAPE to nest activation under
   `effective.activation.{enabled,mode}` (`config-status.ts:99-110`). The modal prefill still
   reads TOP-LEVEL `effective.enabled` / `effective.mode` — `field-list.ts:326-327` via
   `prefillScalar("enabled")` / `prefillString("mode")` (`field-list.ts:135-163`). Those
   extractors were written against the routing DOMAIN port's `StatusResponse` (top-level
   `enabled`/`mode`, `routing-service.ts:431-432`) — the shape BEFORE Feature 036 shadowed
   the id. So EVEN a populated read (e.g. `Request scope = Global`) seeds nothing, because
   `effective.enabled` / `effective.mode` are `undefined` (the values now live under
   `effective.activation`).

The two facets compound: (1) means the persisted global activation is never even fetched at
the default scope; (2) means that even when it IS fetched (global scope), the modal cannot
read it. The parity target — what a `op routing show` / effective status reports for the
resolved scope — is the layered `resolveEffective` read that `smart.status` already surfaces
correctly and live in the operator status card (`dialog-settings.tsx:262-284`).

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Reopening a Configure modal reflects the persisted config

- As an operator, I want the "Routing configure" modal to open PREFILLED with the persisted
  activation (`Enabled`, `Mode`, and advanced policy) for the resolved scope — matching what
  the `op` CLI status reports — so I never see `off` / `— select —` while a real
  `global:routing` (or project) activation is persisted.

### P1 — TUI value set equals the CLI report

- As an operator, I want every operator Configure modal's prefilled value set to equal what
  the corresponding `op … show` / effective status reports for the same scope, so the
  interface gives the same experience as the command and never disagrees with the CLI about
  what is configured.

### P1 — No persisted value is lost on reopen

- As an operator, I want a value I saved (e.g. a global `enabled:true, mode:auto`) to still
  be shown the next time I open the modal, so a Save followed by a reopen is idempotent from
  the operator's point of view and never silently drops a stored field.

### P2 — Switching Request scope re-reads that scope's config

- As an operator, I want switching the "Request scope" picker (project ↔ global) to re-read
  and reflect THAT scope's effective config, so the modal always shows the config the write
  would land on and update, dynamically, without reopening the modal.

### P2 — Parity across all operator config modals

- As an operator, I want the same dynamic, scope-resolved prefill for every config-backed
  Configure modal (routing.configure, smart, pools, budget — and the forthcoming operator
  config-domain surfaces: hierarchy and capability), so the whole operator surface reflects
  persisted state uniformly, not just one modal.

## Functional Requirements

### Group A — dynamic prefill parity with the effective read (FR-A)

1. **FR-A1 — the modal prefills from the effective persisted config, scope-resolved.** A
   Configure modal MUST seed its fields from the SAME effective read the `op` CLI status
   surfaces report for the resolved scope — the layered `resolveEffective`
   (`project > global > default` document-shadowing) that `smart.status` already consumes —
   so a persisted `global:routing` activation is reflected at the default (project) scope via
   shadowing, not reported as `unconfigured`.

2. **FR-A2 — the prefilled value set equals the CLI report.** For a given resolved scope, the
   set of values the modal prefills (`enabled`, `mode`, advanced policy; and the analogous
   fields of the smart/pools/budget modals) MUST equal the value set the corresponding `op …
   show` / effective status reports for that scope. No field the CLI reports may be dropped,
   and no field may be fabricated.

### Group B — scope-resolved read on open and on switch (FR-B)

3. **FR-B1 — the prefill read honors the modal's Request scope.** The modal's prefill read
   MUST thread the currently-selected Request scope (Feature 034) into the read, so the
   read resolves that scope's authority/effective config — not an unconditional project
   default. The default selection (`project`) is preserved (Feature 034 back-compat).

4. **FR-B2 — switching Request scope re-reads and re-seeds.** Changing the Request-scope
   picker MUST re-issue the scope-resolved read and re-seed the non-secret fields from the
   new scope's effective config, without closing the modal, so the displayed values always
   match the scope the write targets.

### Group C — the field-mapping contract (FR-C)

5. **FR-C1 — the prefill extractors read the effective read's ACTUAL shape.** The per-field
   prefill extractors MUST read the shape the chosen effective read returns (activation
   nested under `activation.{enabled,mode}` for the config-status projection, or the pinned
   equivalent), NOT the stale top-level `effective.enabled` / `effective.mode` shape the
   Feature 017 extractors assumed. The `config.json` → modal-field mapping MUST be explicit
   and covered by a test.

6. **FR-C2 — a toggle/picker seeds from a real persisted value or an honest default.** A
   persisted `enabled:true` MUST render `[x] on`; a persisted `mode` MUST render as the
   selected picker option; and ONLY a genuinely-absent value renders the honest `[ ] off` /
   `— select —` placeholder. The placeholder MUST NOT appear when a value is persisted for
   the resolved scope.

### Group D — realtime refresh, mirroring the working panel pattern (FR-D)

7. **FR-D1 — reflect committed saves without a manual reopen.** After a committed Save, the
   modal (and the backing operator status card) MUST reflect the new persisted value, reusing
   the established read-on-open + refetch-after-committed-mutation pattern the operator status
   panel already uses (`dialog-settings.tsx` `loadStatus` + `createEffect(on(statusVersion,
   …, { defer:true }))`, `entity-screens.tsx` `refreshKey`). No new dispatch path or store is
   introduced — the read rides the same `executeOperatorCommand` loopback.

### Group E — parity coverage across the config-backed Configure modals (FR-E)

8. **FR-E1 — the parity contract applies to every config-backed Configure modal.** The
   dynamic, scope-resolved, correctly-mapped prefill MUST hold for `routing.configure`,
   `smart` (activation), `pools.set` (role bindings), and `budget.set` — each seeded from its
   scope-resolved effective read — and MUST be structured so the forthcoming operator
   config-domain modals (hierarchy, capability) inherit the same contract rather than
   re-deriving a blank-default modal.

## Non-Functional Requirements

- **Read-only, no write-path change.** This feature changes only how a Configure modal READS
  its initial values; the Save/CAS/scope write path (Features 024/034/035) is byte-for-byte
  unchanged. A modal opened and closed without Save persists nothing.
- **One effective-read SSOT.** The modal prefill reuses the SAME effective read the CLI/status
  card use; it introduces no parallel read, store, or scope→authority map.
- **Honest absence.** An absent value for the resolved scope renders the honest placeholder,
  never a fabricated `on`/mode; an unavailable read leaves the modal on its empty baseline and
  never blocks opening.
- **Zero provider/model cost.** The prefill read is model-independent and offline-capable — no
  provider/model calls, tokens, or cost — like every operator read.

## Security Requirements

- **Data sensitivity/classification.** This feature reads operator configuration metadata
  (routing activation flags, mode, role-pool model ids, budget limits) from the persisted
  `routing` / `global:routing` (and sibling) Config authorities to PREFILL a modal. It reads
  no end-user content and no credential. Secret-bearing fields are already excluded from
  prefill (`multi-field-modal.tsx` skips `field.secret`) and stay excluded — a secret is never
  pre-filled from a resolved value.
- **Authentication/authorization.** No new authenticated surface, credential, or permission
  boundary. The prefill read rides the existing Feature 007 operator principal and the Feature
  034 scope-authorization matrix unchanged — a project-bound principal reads only the scopes it
  is already authorized to target; the fix only corrects WHICH authority/effective config the
  already-authorized read consults and HOW the modal maps it.
- **Input validation.** The untrusted input is unchanged (the operator command envelope and
  the operator-entered field values validated on Save). Prefill parses only already-persisted,
  schema-validated config into typed fields, defaulting safely on any absent/malformed value
  (honest placeholder), and never trusts the read to bypass the Save-time validation.
- **Cryptography in transit/at rest.** Not applicable — the prefill reads through the existing
  `ConfigPort.get` / `resolveEffective` boundary; it adds no new data-in-transit path and no
  new at-rest requirement, and it surfaces only the redacted activation projection, never the
  raw payload.
- **Logging/audit.** No new logging. The prefill read is a silent query through the existing
  Feature 007 query-audit path; no authority payload is carried into a log line, and a silent
  read emits no toast.
- **Error-handling information exposure.** A failed/unavailable prefill read leaves the modal
  on its honest empty baseline and never surfaces a raw cause string or config fragment; the
  modal's in-modal error surface (Feature 017) is reserved for Save-time failures, unchanged.

## Acceptance Scenarios

Given the operator control plane is enabled, a project is bound, and ONLY a `global:routing`
document is persisted (`activation.enabled = true`, `mode = auto`)

- **Reopening the Routing configure modal reflects the persisted global activation (FR-A,
  FR-C).**
  Given the persisted `global:routing` activation and no project `routing` document,
  When the "Routing configure" modal opens,
  Then `Enabled` renders `[x] on` and `Mode` renders `Auto` — NOT `[ ] off` / `— select —` —
  because the modal prefilled from the effective (shadowed) read and mapped the activation
  shape correctly.

- **The modal value set equals the CLI report (FR-A2).**
  Given the same persisted activation,
  When the modal prefills and the operator reads the corresponding `op` status for the same
  scope,
  Then the modal's prefilled `enabled`/`mode` (and advanced policy) equal the value set the
  CLI status reports — the two never disagree.

- **Switching Request scope re-reads that scope's config (FR-B).**
  Given the modal open at `Request scope = Project` reflecting the shadowed global activation,
  When the operator switches `Request scope` to `Global`,
  Then the modal re-reads and reflects the `global:routing` document directly (still
  `enabled:true, mode:auto`), without closing the modal.

- **No saved value is lost on reopen (FR-A2, FR-D).**
  Given the operator saved `enabled:true, mode:auto` at global scope,
  When the modal is closed and reopened at that scope,
  Then it re-prefills `enabled:true, mode:auto` — the Save→reopen round-trip drops nothing.

- **Honest absence when truly unconfigured (FR-C2).**
  Given NO routing document at the resolved scope (nor a shadowing scope),
  When the modal opens,
  Then `Enabled` renders `[ ] off` and `Mode` renders `— select —` — the honest placeholder,
  because no value is persisted for that scope.

## Observability

This is a TUI read-path parity fix: the modal prefill rides the existing
`executeOperatorCommand` loopback and the existing operator query-audit path — it emits no new
metrics, log events, or trace spans, and adds no new backend surface. The behavioral change is
confined to (1) the scope the modal's prefill read resolves, (2) the effective/layered read it
consults, and (3) the field-mapping shape the modal reads. Operator queries project through the
Feature 007 query audit and the ADR-0001 OTLP foundation with content-free, bounded labels —
unchanged. Conventions live in `doc/arch/observability/observability.md`.

## Domain Model

```
Routing configure modal (multi-field-modal.tsx)
  onMount → load() → prefillFromRead(initial)                                     (Feature 017)
      readId = "routing.status"  (field-list.ts:324)
      executeOperatorCommand({ entry: routing.status, silent:true,
                               requestedScope: <selected scope> })   <- FR-B1 (was: omitted → project)
        |
        v
config-status routing.status handler (config-status.ts)
  DEFECT 1: single config.get(routingStatusAuthority(scope.kind))                 (does NOT shadow global)
  FIX (design): consult the effective/layered read (resolveEffective:
                project > global > default) that smart.status already uses         (FR-A1)
        |
        v
  effective = { activation: { enabled, mode }, configured, authority, ... }        (Feature 036 shape)
        |
        v
per-field prefill (field-list.ts)
  DEFECT 2: prefillScalar("enabled") / prefillString("mode") read TOP-LEVEL        (stale domain-port shape)
  FIX: read effective.activation.{enabled,mode}                                    (FR-C1)
        |
        v
  Enabled [x] on · Mode Auto   (persisted value shown; placeholder only on honest absence)  (FR-C2)

realtime: read-on-open + refetch-after-committed-save + re-read on scope switch     (FR-B2, FR-D1)
  mirrors dialog-settings.tsx loadStatus + createEffect(on(statusVersion, …, {defer:true}))
```

## Out of Scope

- **Implementing the new operator config domains themselves** (the hierarchy and capability
  surfaces) — those are owned by the sibling operator config-domains feature; this feature only
  establishes the dynamic-prefill parity contract they inherit.
- **Any write/CAS/scope persistence change** (Features 024/034/035) — the Save path is
  untouched; this is a read-side prefill fix.
- **Changing the routing config schema, the catalog, or the routing engine's effective-config
  resolution** — the fix reuses the existing effective read; it does not alter shadowing
  precedence or the engine.
- **Removing the Feature 036 config-backed `routing.status` shadow** — the shadow stays; the
  fix reconciles what it returns (and what the modal reads) with the effective-read parity the
  CLI already provides.

## Related Features and Decisions

- [ADR-0040 — Operator TUI modals prefill from the persisted authority via the effective read](../../adr/0040-bring-the-operator-tui-to-full-parity-with-the-op-cli-and.md)
- [Feature 007 — Add a unified native operator control plane for all opencode](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — the operator control plane and command registry the modals dispatch through.
- [Feature 017 — Close the implementable operator capability gaps](../017-close-the-implementable-operator-capability-gaps-so-the/spec.md) — built the multi-field prefill (read-on-open → seed) whose extractors this feature reconciles.
- [Feature 024 — Implement routing.configure persistence](../024-implement-routing-configure-persistence-so-operator-routing/spec.md) — the `routing.configure` write path the modal Save uses (untouched).
- [Feature 034 — Add an explicit operator scope selector](../034-add-an-explicit-operator-scope-selector-so-global-scoped/spec.md) — the Request-scope selector the prefill read must now honor.
- [Feature 036 — Fix the operator routing.status query so it honors the request scope](../036-fix-the-operator-routing-status-query-so-it-honors-the/spec.md) — introduced the scope-aware, nested-activation `routing.status` shape this feature's prefill must read (and shadow).
- [Feature 030 — Correct feature 028 so an OPENCODE_CONFIG_DIR profile layers](../030-correct-feature-028-so-an-opencode-config-dir-profile-layers/spec.md) — the layered global config read the effective (`resolveEffective`) parity depends on.
- [Feature 037 — Wire the operator Smart Routing engine into the live session](../037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md) — the live effective read whose semantics the modal must match.

## Clarifications

### Session 2026-07-21

- **The defect is a compound READ defect, not a missing read or a wrong widget.** The modal
  DOES read on open and DOES carry prefill functions; it fails because (1) the read is
  project-scoped single-authority (never shadows `global:routing`) and (2) the prefill reads a
  stale top-level shape while Feature 036 nested activation under `effective.activation`.
  Both facets were introduced when Feature 036 re-shadowed `routing.status`.
- **Parity target = the effective read the CLI status surfaces report.** The working,
  realtime reference is `smart.status` → `resolveEffective` (project > global > default), which
  correctly shows the persisted global activation live in the operator status card. The modal
  must reach the same value set for the resolved scope. [OPEN — brain decision] whether to
  point the modal at the effective/layered read directly (recommended) or to enrich the
  Feature 036 `routing.status` handler to shadow while staying scope-honoring; the plan records
  both and recommends reusing the effective read with a corrected field mapping.
- **The prefill read must honor the Request scope.** Today `prefillFromRead` omits
  `requestedScope`, so the read is always project-default; it must thread the selected scope
  and re-read on scope switch (Feature 034 selector already carries the value on Save).
- **The realtime pattern already exists.** The operator status panel's read-on-open +
  refetch-after-committed-mutation (`dialog-settings.tsx`) is the pattern to mirror; no new
  dispatch path or store is added.
</content>
</invoke>
