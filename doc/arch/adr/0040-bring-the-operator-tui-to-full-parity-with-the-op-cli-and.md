---
status: accepted
date: 2026-07-21
deciders: [project maintainers]
consulted: []
informed: []
---

# 0040 — Operator TUI Modals Prefill From The Persisted Authority Via The Effective Read

## Context and Problem Statement

With a persisted GLOBAL smart-routing activation (`global:routing`: `activation.enabled =
true`, `mode = auto`, role_pools, budget), the operator TUI "Routing configure" modal opens on
`Enabled [ ] off`, `Mode — select —`, and `Request scope = Project (this directory)` — it does
NOT reflect the persisted `config.json`. The operator expects the interface to give the SAME
experience as the `op` CLI: whatever `op routing show` / the effective status reports for the
resolved scope, the modal must display, prefilled dynamically and updated in realtime.

The modal is not blank-by-design: it DOES issue a read on open (`prefillFromRead`,
`multi-field-modal.tsx:202-221`, `readId:"routing.status"` at `field-list.ts:324`) and DOES
carry per-field prefill functions. The failure is a COMPOUND read-and-map defect, both facets
introduced when Feature 036 re-shadowed `routing.status`:

1. **Scope + single-authority read.** The prefill read omits `requestedScope`, so the
   scope-aware config-status handler (`config-status.ts:92-113`; `routingStatusAuthority` at
   `:61-63`) resolves the PROJECT `routing` authority and performs a single `config.get` —
   never the layered `resolveEffective`. With only a `global:routing` document set, the project
   authority is empty → `configured:false`, `activation:null`. The global activation is never
   fetched at the default scope.

2. **Field-mapping / shape mismatch.** The extractors `prefillScalar("enabled")` /
   `prefillString("mode")` (`field-list.ts:326-327`, defs `:135-163`) read TOP-LEVEL
   `effective.enabled` / `effective.mode` — the routing DOMAIN-port `StatusResponse` shape
   (`routing-service.ts:431-432`) — but Feature 036 nests activation under
   `effective.activation.{enabled,mode}` (`config-status.ts:99-110`). So even a populated read
   (e.g. explicit global scope) seeds nothing.

The working, realtime reference already in the codebase is `smart.status`, which reads the
layered effective config (`resolveEffective`: project > global > default,
`config-adapter.ts:125-131`, consumed by `smart/backend-live.ts:91-94`) and surfaces the
persisted global activation correctly and live in the operator status card
(`dialog-settings.tsx:262-284`, read-on-open + refetch-after-committed-mutation). The question:
how to make the Configure modals prefill dynamically from that same effective authority,
scope-resolved and correctly mapped, reaching full parity with the `op` CLI — without touching
the Save/CAS/scope write path or the routing engine.

## Decision Drivers

- **Parity with the command.** The modal's prefilled value set must equal what the `op` CLI
  status reports for the resolved scope; the two must never disagree about what is configured.
- **Reflect the persisted authority dynamically.** A persisted activation (global or project)
  must render as `[x] on` / the mode option, from the effective (shadowed) read — never a
  static `off` / `— select —` while a real config is stored.
- **Scope-resolved.** The read must honor the modal's Request-scope selection (Feature 034) and
  re-read on switch, so the displayed values match the scope the write targets.
- **Reuse, do not fork.** Reuse the effective read the CLI/status card already use and the
  established read-on-open + refetch realtime pattern; add no parallel read, store, or
  scope→authority map.
- **Read-only blast radius.** No change to the Save/CAS/scope write path (Features 024/034/035),
  the routing schema, the catalog, or the engine.
- **A uniform contract.** The fix must generalize across the config-backed Configure modals
  (routing.configure, smart, pools, budget) so the forthcoming operator config-domain modals
  (hierarchy, capability) inherit it.

## Considered Options

- **Option A — enrich the config-status `routing.status` read to project the EFFECTIVE
  (shadowed) activation, thread the Request scope from the modal, and fix the field-mapping
  shape (chosen).** The modal threads its selected Request scope into the prefill read; the
  `routing.status` handler resolves the shadowed effective activation (`resolveEffective`:
  project > global > default) for project/bare scope and `global:routing` directly under global
  scope; the prefill extractors read `effective.activation.{enabled,mode}` (with a back-compat
  fallback to the top-level domain-port shape). Keeps the modal `readId` stable, makes the
  status read AGREE with `smart.status`, and honors Feature 036 scope-awareness while adding the
  shadowing the modal needs.
- **Option B — re-point the `routing.configure` descriptor `readId` at `smart.status`.** The
  modal prefills from the smart effective summary and maps from `SmartSummary`. Rejected: it
  splits the read the modal uses from the config-backed status handler, and `smart.status`
  carries `auto` (a boolean) not `mode`, widening the mapping surface and coupling the routing
  modal to the smart projection.
- **Option C — leave the read as-is and only fix the field-mapping shape.** Rejected: it maps a
  read that, at the default project scope, still returns an empty single-authority document — so
  the persisted global activation would remain invisible; it treats one facet of a compound
  defect.
- **Option D — thread the scope only, leaving the single-authority (non-shadowing) read and the
  stale mapping.** Rejected: at project scope with a global-only config it still reports
  `configured:false`, and the stale top-level extractors still seed nothing; parity with the
  effective/CLI report is not reached.

## Decision Outcome

Chosen option: **Option A**. The operator Configure modals prefill from the persisted authority
via the effective (layered, shadowed) read the `op` CLI status surfaces already report,
scope-resolved from the modal's Request-scope selection and correctly field-mapped to the
Feature 036 activation shape, refreshed in realtime via the existing read-on-open +
refetch-after-committed-mutation pattern.

Key decisions recorded:

1. **Prefill reads the effective, scope-resolved authority.** The modal threads its selected
   Request scope into the prefill read; the `routing.status` read shadows `global:routing` under
   project/bare scope (via `resolveEffective`) and reads `global:routing` directly under global
   scope. This supersedes the Feature 036 accepted residual that the project/bare read reports
   `configured:false` under a global-only config — the read now shadows, agreeing with
   `smart.status`.
2. **The field-mapping shape is reconciled.** The `enabled`/`mode` extractors read
   `effective.activation.{enabled,mode}` (with a back-compat fallback to the top-level
   domain-port shape), so a populated read seeds `[x] on` / the mode option; only a genuinely
   absent value renders the honest `[ ] off` / `— select —` placeholder.
3. **Re-read on scope switch.** Changing the Request-scope picker re-issues the scope-resolved
   read and re-seeds the non-secret fields without closing the modal, via a deferred
   `createEffect` mirroring the panel's `on(statusVersion, …, { defer:true })` idiom.
4. **Reuse the realtime pattern; no new dispatch path.** The prefill and refresh ride the same
   `executeOperatorCommand` loopback and the same read-on-open + refetch-after-mutation pattern
   the operator status panel uses (`dialog-settings.tsx`, `entity-screens.tsx`); no new store or
   port is added.
5. **Read-only.** The Save/CAS/scope write path (Features 024/034/035), the routing schema, the
   catalog, and the engine's effective-config resolution are unchanged; secret fields stay
   excluded from prefill.
6. **A uniform contract.** The same dynamic, scope-resolved, correctly-mapped prefill applies to
   routing.configure, smart, pools, and budget, and is structured so the forthcoming operator
   config-domain modals (hierarchy, capability) inherit it.

### Consequences

- Good: the "Routing configure" modal (and every config-backed Configure modal) opens
  reflecting the persisted authority for the resolved scope — full parity with the `op` CLI
  status report, no static `off`/`— select —` over a real config.
- Good: `routing.status` (project/bare) now agrees with `smart.status` about the effective
  activation, closing the Feature 036 divergence for the shadowed case.
- Good: switching Request scope dynamically re-reflects that scope's config; a Save→reopen
  round-trip drops nothing.
- Neutral: enriching `routing.status` to shadow changes what a project/bare read reports for a
  global-only config (from `configured:false` to the shadowed activation) — a deliberate
  supersession of a Feature 036 residual that must be recorded in that feature's residual and
  the config-status comment, and its regression test updated (not weakened silently).
- Residual: the forthcoming operator config-domain modals (hierarchy, capability) are out of
  scope; this feature only establishes the parity contract they inherit. End-to-end TUI parity
  is validated on the binary; unit tests prove the prefill mapping and the effective-read seam.

## Related

- Feature specification: [040 Bring the operator TUI to full parity with the op CLI](../sdd/040-bring-the-operator-tui-to-full-parity-with-the-op-cli-and/spec.md)
- The operator control plane and command registry the modals dispatch through: [007 Add a unified native operator control plane for all opencode](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- The multi-field prefill (read-on-open → seed) reconciled here: [017 Close the implementable operator capability gaps](../sdd/017-close-the-implementable-operator-capability-gaps-so-the/spec.md)
- The routing.configure write path the modal Save uses (untouched): [024 Implement routing.configure persistence](../sdd/024-implement-routing-configure-persistence-so-operator-routing/spec.md)
- The Request-scope selector the prefill read now honors: [034 Add an explicit operator scope selector](../sdd/034-add-an-explicit-operator-scope-selector-so-global-scoped/spec.md)
- Introduced the scope-aware, nested-activation routing.status shape this prefill must read (and shadow): [036 Fix the operator routing status query so it honors the request scope](../sdd/036-fix-the-operator-routing-status-query-so-it-honors-the/spec.md)
- The layered global config read the effective parity depends on: [030 Correct feature 028 so an OPENCODE_CONFIG_DIR profile layers](../sdd/030-correct-feature-028-so-an-opencode-config-dir-profile-layers/spec.md)
- The live effective read whose semantics the modal must match: [037 Wire the operator Smart Routing engine into the live session](../sdd/037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md)
</content>

## Links

- Related: ADR-0011, ADR-0015, ADR-0016, ADR-0024, ADR-0036.
