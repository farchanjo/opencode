# Implementation Plan: Bring The Operator TUI To Full Parity With The op CLI

## Overview

The operator "Routing configure" modal opens on `Enabled [ ] off` / `Mode — select —` /
`Request scope = Project` even when a `global:routing` activation (`enabled:true, mode:auto`,
role_pools, budget) is persisted. The modal already reads on open and already carries per-field
prefill functions, so the fix is NOT "make it read" — it is a COMPOUND read-and-map fix, both
facets introduced when Feature 036 re-shadowed `routing.status`:

1. **Scope + single-authority read.** `prefillFromRead`
   (`packages/tui/src/operator/form/multi-field-modal.tsx:202-221`) dispatches the
   `routing.status` read WITHOUT `requestedScope`, so the scope-aware config-status handler
   (`packages/opencode/src/operator/adapters/outbound/config-status.ts:92-113`,
   `routingStatusAuthority` at `:61-63`) resolves the PROJECT `routing` authority and does a
   single `config.get` — never the layered `resolveEffective` — so the persisted
   `global:routing` document is never fetched at the default scope.

2. **Field-mapping / shape mismatch.** The prefill extractors
   `prefillScalar("enabled")` / `prefillString("mode")`
   (`packages/tui/src/operator/form/field-list.ts:326-327`, defs at `:135-163`) read TOP-LEVEL
   `effective.enabled` / `effective.mode` — the routing DOMAIN-port `StatusResponse` shape
   (`packages/opencode/src/routing/application/routing-service.ts:431-432`) — but Feature 036
   nests activation under `effective.activation.{enabled,mode}`
   (`config-status.ts:99-110`). So even a populated read seeds nothing.

The parity target is the layered effective read the `op` CLI status surfaces report —
`resolveEffective` (project > global > default document-shadowing,
`packages/opencode/src/routing/adapters/outbound/config-adapter.ts:125-131`), which
`operator/smart/backend-live.ts:91-94` consumes and which the operator status card already
surfaces correctly and live via `smart.status`
(`packages/tui/src/operator/dialog-settings.tsx:262-284`).

## Technical Approach

Three coordinated changes: point the modal prefill at the effective read, thread + honor the
Request scope, and fix the field-mapping shape. Save/CAS/scope write path is untouched.

- **Part 1 — prefill from the effective read, scope-resolved
  (`packages/tui/src/operator/form/multi-field-modal.tsx#prefillFromRead`).**
  - Thread the modal's currently-selected Request scope (`store.raw[REQUEST_SCOPE_KEY]`, the
    Feature 034 value already carried on Save at `:324`) into the prefill
    `executeOperatorCommand({ …, requestedScope, silent:true })`. Today the read omits it
    (`:205-213`), so the read is always project-default. (FR-B1)
  - Re-issue the read when the Request-scope picker changes so the fields re-seed for the new
    scope, reusing the existing hoisted-store re-seed path — a `createEffect` keyed on the
    scope value, deferred so the initial `onMount` load is not double-issued. (FR-B2)

- **Part 2 — the effective/layered read the modal consults (backend seam).** The modal's
  `readId` for `routing.configure` is `routing.status`. Two design options (the OPEN decision
  the ADR records); the plan RECOMMENDS Option A:
  - **Option A (recommended) — enrich `createRoutingStatusHandler` to project the EFFECTIVE
    (shadowed) activation** (`config-status.ts:92-113`): for a project/bare scope, resolve via
    `resolveEffective` (project > global > default) instead of a single project `config.get`,
    so the persisted global activation shadows in; for an explicit `global` scope, read
    `global:routing` directly (unchanged). This keeps the modal's `readId` stable and makes the
    status read agree with `smart.status`, honoring Feature 036's scope-awareness while adding
    the shadowing the modal needs. It supersedes the Feature 036 accepted residual that the
    project/bare read reports `configured:false` under a global-only config.
  - **Option B — re-point the `routing.configure` descriptor `readId` at `smart.status`** (the
    effective read) and map from the `SmartSummary` shape. Rejected in the plan (it splits the
    read the modal uses from the status handler, and `smart.status` carries `auto` not `mode`,
    widening the mapping surface), but recorded as the alternative.

- **Part 3 — the field-mapping contract
  (`packages/tui/src/operator/form/field-list.ts`).**
  - Add prefill extractors that read the effective read's ACTUAL shape:
    `enabled` from `effective.activation.enabled` (boolean → `"true"`/`"false"` for the
    toggle), `mode` from `effective.activation.mode` (string → the picker option). A
    back-compat fallback to the top-level `effective.enabled`/`effective.mode` keeps the
    routing DOMAIN-port shape working for any stack that serves it. (FR-C1)
  - Confirm the honest-placeholder path: an absent activation seeds nothing → `[ ] off` /
    `— select —`; a present activation seeds the real value → `[x] on` / the mode option.
    (FR-C2)

- **Part 4 — parity across the config-backed Configure modals (FR-E).** `smart` activation,
  `pools.set` (already `prefillBindings` over `effective.bindings`), and `budget.set`
  (`prefillNestedScalar("limits", …)`) are audited against their scope-resolved effective read
  so each seeds correctly; the request-scope threading in Part 1 applies to every
  scope-flexible Configure modal (`isScopeFlexibleCommand`), so the forthcoming operator
  config-domain modals (hierarchy, capability) inherit the same contract.

### Field-mapping contract (config.json → modal fields)

```
persisted routing config.json                effective (Feature 036 shape)      modal field
  activation.enabled : bool          →  effective.activation.enabled     →  Enabled  [x]/[ ]
  activation.mode    : "always|auto|never"  →  effective.activation.mode →  Mode     picker
  enforcement.budget (advanced)      →  (advanced policy JSON, unchanged) →  Advanced policy
  models.role_pools  : [{role,models}] →  effective.bindings (pools read) →  Role bindings
```

### Realtime pattern to reuse

Mirror `DialogOperatorDomainPanel` (`dialog-settings.tsx:262-284`): read-on-open (`onMount →
load`) + refetch on a bumped signal after a committed mutation
(`createEffect(on(statusVersion, () => void loadStatus(), { defer:true }))`), and
`entity-screens.tsx:86-110` (`refreshKey` + deferred `createEffect(on(refreshKey, load))`). The
modal adds one more trigger — the Request-scope value — to the same deferred-re-read idiom. No
new dispatch path or store; the read rides the same `executeOperatorCommand` loopback.

### Test strategy (read-parity)

- **TUI prefill parity test** (`packages/tui/test/operator/…`): drive `prefillFromRead` (or the
  pure prefill mapping) over a fixture effective payload matching the Feature 036 shape and
  assert the seeded field set — `enabled → "[x] on"`, `mode → "Auto"` — equals the persisted
  activation; assert honest placeholder on an absent activation. Assert the read is issued WITH
  the selected `requestedScope`, and re-issued on scope switch.
- **Backend effective-read parity test** (`packages/opencode/test/operator/…`, if Option A):
  over the wired dispatcher (smart + budget + pools + routing over one shared `store.config`,
  Feature 036 harness), with ONLY `global:routing` set, assert `routing.status` (project/bare)
  now reports the shadowed activation `{ enabled:true, mode:"auto" }` and AGREES with
  `smart.status`; assert explicit `--scope global` and `--scope project` behavior; no existing
  Feature 036 assertion weakened (project-authority `configured` field semantics preserved or
  explicitly updated with the superseded-residual note).
- **Round-trip**: a Save at a scope followed by a reopen re-prefills the saved value (no drop).

## Companion Artifacts

No companion files are required: this feature re-points an existing read, threads an existing
scope value, and corrects a field-mapping shape — it adds no new entity, external contract, or
integration. The optional `research.md` / `data-model.md` / `contracts/` / `quickstart.md` are
intentionally omitted (the Domain Model + field-mapping contract in `spec.md`/`plan.md` carry
the flow); the `.feature` / `.cue` scaffolds follow the 024–039 convention.
</content>
