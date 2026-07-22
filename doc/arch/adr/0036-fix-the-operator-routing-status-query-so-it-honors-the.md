---
status: accepted
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0036 — Fix The Operator Routing Status Query So It Honors The Request Scope

## Context and Problem Statement

A coherent Smart Routing config lives on ONE routing document persisted under a per-scope Config
authority: `routing` for project scope, `global:routing` for global scope. Feature 033 established
that mapping (`SMART_AUTHORITY = { global: "global:routing", project: "routing" }`), Feature
024/025 made `routing.configure`/smart/budget follow the request scope, and Feature 034 made
global scope reachable from the real CLI/TUI/HTTP frontends (`--scope global`).

But `routing.status --scope global` reported `configured:false` (and null activation) when a
routing config was set at GLOBAL scope, EVEN THOUGH `smart.status --scope global` correctly
reported `enabled:true, auto:true, configured:true` from that same `global:routing` document:

```
export OPENCODE_CONFIG_DIR=/tmp/f036-repro OPENCODE_OPERATOR_CONTROL_PLANE=1
op smart on   --scope global ; op smart auto --scope global   # writes global:routing (enabled+auto)
op smart status  --scope global    # -> enabled:true, auto:true, configured:true   (CORRECT)
op routing status --scope global   # -> configured:false, activation:null          (WRONG)
```

Root cause: `routing.status` is served config-backed, NOT by the routing domain port.
`handlersFromDomainPorts` (`operator/adapters/outbound/domain-stubs.ts`) maps every reserved id to
the domain handler, then OVERRIDES `routing.status` (and the `semantic.*` ids) with the
config-status handler; the dispatcher resolves `handlers.get("routing.status")` FIRST
(`application/dispatcher.ts`), so the routing domain port's
`routing.status → RoutingPort.status()` case (`routing/adapters/inbound/routing-command-port.ts`)
is SHADOWED in every stack that passes a `ConfigPort` (the live stack and every wired test). The
config-status handler (`createConfigStatusHandler`) resolved its authority from
`authorityKeyForCommandId("routing.status")`; `staticAuthorityForCommandId` has no `routing`
entry, so it fell back to the id prefix `"routing"` — the PROJECT authority, INDEPENDENT of
`ctx.request.scope.kind`. So a global-scope request read the (absent) project `routing` document
and reported `configured:false`. `smart.status` is deliberately excluded from the shadow (Feature
013 T010) and routes through its real domain port, whose `resolveEffective` (project doc > global
doc > default) resolves the global document — hence the parity `routing.status` broke.

The question: how to make `routing.status` honor the request scope on READ — resolving
`global:routing` under global scope and `routing` under project (and bare) scope — WITHOUT
changing any write, the routing config schema, the catalog, the Feature 033 document-shadowing
precedence, or the routing engine's own effective-config resolution, and WITHOUT weakening the
config-backed `configured`/`authority` contract that Feature 007/013 tests lock.

## Decision Drivers

- **A scoped status read reflects the scope's authority.** `routing.status --scope global` must
  read `global:routing`; `routing.status --scope project` (and bare) must read `routing` — the
  correctness guarantee this feature enforces.
- **Parity with `smart.status`.** For the same `global:routing` document, `routing.status --scope
  global` and `smart.status --scope global` must agree on enabled/mode; the two operator surfaces
  must never disagree about whether Smart Routing is configured/enabled.
- **Reuse the single scope→authority SSOT.** The read must resolve the authority via the existing
  `SMART_AUTHORITY` map (`smart`/`budget`/`pools`/`routing.configure` and the mutation preflight
  all use it); no parallel mapping may be introduced.
- **Read-only, minimal blast radius.** No write, CAS, schema, catalog, dispatch, or
  routing-engine-resolution change; the fix is confined to one status read handler.
- **Preserve the config-backed contract.** Project/bare `routing.status` must still report the
  config-backed `configured`/`authority`/`hasPayload` fields, and the generic config-status
  handler (still serving `semantic.*`) must be unchanged — Feature 007/013 assertions must all
  pass, unweakened.

## Considered Options

- **Option A — Make the config-backed `routing.status` read scope-aware (chosen).** Add a
  dedicated `createRoutingStatusHandler(config)` that resolves its authority from
  `ctx.request.scope.kind` via the shared `SMART_AUTHORITY` SSOT (`global` → `global:routing`,
  else → `routing`), reads `ConfigPort.get(authority)`, and projects the redacted activation
  (`enabled` + `mode`). `routing.status` maps to this handler; the `semantic.*` ids keep the
  generic scope-blind handler unchanged. This is the minimal fix at the exact seam that served
  the scope-blind read, it reuses the established mapping, and it preserves the config-backed
  `configured`/`authority` contract (project/bare still resolve `routing`).
- **Option B — Move `routing.status` off the config-status shadow onto the routing domain port
  (`RoutingPort.status()`), threading the scope through the routing service.** Rejected: the
  config-backed shadow is a deliberate, test-locked contract (Feature 013 T010; Feature 007/013
  assert `routing.status` returns the `configured`/`authority`/`hasPayload` projection, not the
  routing engine's `StatusResponse`). Removing the shadow would change the response shape and
  WEAKEN those assertions, and it would require the routing service to gain a scope-aware config
  read (a new `RoutingConfigSource` method threaded through every call site) — a far larger,
  riskier change for a path that is otherwise shadowed. The status projection the operator surface
  needs (`configured` + activation) is exactly what the config-backed handler already returns.
- **Option C — Add a `routing` entry to `staticAuthorityForCommandId` so the generic handler
  resolves it.** Rejected: `staticAuthorityForCommandId` is the SCOPE-INDEPENDENT static map (it
  deliberately returns `null` for the scope-dependent `smart`/`budget`/`routing`/`langlock` domains
  so the wired resolver handles them by scope). Adding a static `routing` entry would either pin a
  single scope (wrong) or duplicate the scope logic in the wrong place. The scope belongs threaded
  into the read, keyed on the shared `SMART_AUTHORITY`, not baked into the static fallback.
- **Option D — Change `resolveEffective` / the routing engine resolution so a scoped status
  read shadows differently.** Rejected and out of scope: the document-shadowing read (Feature 033)
  and the engine's effective-config resolution are correct; the defect is a missing scope thread
  on the status read, not a precedence question. Touching shadowing would risk the effective-config
  semantics the engine and `smart.status` depend on.

## Decision Outcome

Chosen option: **Option A**, because threading the request scope into the config-backed
`routing.status` read — via the existing `SMART_AUTHORITY` SSOT — resolves the scope's authority
(`global:routing` under global scope, `routing` otherwise), makes a scoped `routing.status` agree
with `smart.status` on enabled/mode, preserves the config-backed `configured`/`authority` contract
for project/bare reads, and leaves every write, the schema, the catalog, the Feature 033
document-shadowing read, and the routing engine's effective-config resolution byte-for-byte
unchanged — with a single dedicated handler at the seam that served the scope-blind read.

Key decisions recorded:

1. **Thread the request scope into the `routing.status` read (FR-A).**
   `createRoutingStatusHandler(config)`
   (`packages/opencode/src/operator/adapters/outbound/config-status.ts`) resolves
   `authority = SMART_AUTHORITY[ctx.request.scope.kind === "global" ? "global" : "project"]`,
   reads `ConfigPort.get(authority)`, and `configStatusHandlersFromPort` maps `routing.status` to
   it (removed from the generic `STATUS_SHOW_IDS`; the `semantic.*` ids keep the generic handler).
   This is the only behavioral change.
2. **Project the redacted activation for parity (FR-B).** The scoped read returns
   `configured`/`status`/`authority`/`hasPayload` plus `activation` = `{ enabled, mode }` from the
   document payload (or `null` when absent) — only the non-secret activation flags `smart.status`
   already exposes, never the raw payload — so `routing.status --scope global` and `smart.status
   --scope global` agree on enabled/mode.
3. **`SMART_AUTHORITY` stays the SSOT (invariant).** The scoped read keys on the SAME
   `SMART_AUTHORITY` map the write routing, the mutation preflight, and `routing.configure` use;
   no parallel routing-authority-per-scope definition is introduced.
4. **Project/bare reads and everything else unchanged (FR-C).** A `--scope project` and a bare
   `routing.status` still resolve `routing` and report the same config-backed fields; the generic
   `createConfigStatusHandler` (`semantic.*`), `resolveEffective` document-shadowing, the routing
   engine resolution, the operator schema, the catalog, and every write are byte-for-byte
   unchanged. No operator payload, command id, catalog version, or dispatch path changes.
5. **The shadowed domain-port `RoutingPort.status()` is left untouched (accepted residual).** Its
   `routing.status → RoutingPort.status()` case
   (`routing/adapters/inbound/routing-command-port.ts`) is never reached in a stack that passes a
   `ConfigPort` (every live and wired stack), so threading scope there would be inert. It is
   recorded as a latent, accepted residual rather than changed, to keep the fix confined to the
   live seam.
6. **Regression test over the wired dispatcher (load-bearing).** A test in
   `packages/opencode/test/operator/feature036-routing-status-scope.test.ts` (mirroring
   `feature034-explicit-scope.test.ts`) drives the wired dispatcher (smart + budget + pools +
   routing over one shared `store.config`, the production authority resolver threaded, a bound
   `projectId`), seeds ONLY a `global:routing` document (enabled + auto), and asserts
   `routing.status --scope global` reports `configured:true` + `activation:{ enabled:true,
   mode:"auto" }`, that `routing.status`/`smart.status` agree at global scope, that `--scope
   project` still reads `routing` (`configured:false`), and that a bare `routing.status` still
   reads `routing`. It fails on the pre-fix source and passes after. **[Superseded by Feature
   040]** — the (c)/(d) project/bare `configured:false`-under-global assertions were updated to
   the shadowed behavior; see the supersession note in Consequences.

### Consequences

- Good: `routing.status --scope global` now reflects the `global:routing` document
  (`configured:true` + the global activation) — the scope-blind read is closed and test-locked.
- Good: `routing.status` and `smart.status` agree at the same scope — the operator surfaces no
  longer disagree about whether Smart Routing is configured/enabled.
- Good: project/bare `routing.status` is unchanged (still resolves `routing`), so the Feature
  007/013 config-backed assertions all pass, unweakened. **[Superseded by Feature 040,
  ADR-0040]** — to reach TUI/CLI prefill parity, the project/bare `routing.status` read now
  resolves the LAYERED effective config (`resolveEffective`: project > global > default, the
  same read `smart.status` consumes), so a global-only activation SHADOWS into the project scope
  (`configured:true` + the shadowed activation) instead of reporting `configured:false`. This
  deliberately supersedes the "project/bare unchanged" residual above; the (c)/(d) regression
  assertions in `feature036-routing-status-scope.test.ts` were updated to the shadowed behavior
  (not weakened), and the Feature 007 fixture was made schema-valid so the effective read decodes
  it. Explicit `--scope global` still reads `global:routing` directly (unchanged).
- Good: the Feature 033 document-shadowing read, the routing engine's effective-config resolution,
  the operator schema, the catalog, and every write are untouched — only the scoped read authority
  changes.
- Neutral: the scoped read now projects a redacted `activation` (`enabled` + `mode`) alongside the
  existing `configured`/`authority` fields — additive, non-secret, matching `smart.status`.
- Residual (accepted): the shadowed domain-port `RoutingPort.status()` remains scope-blind, but it
  is never reached in a stack that passes a `ConfigPort` (every live and wired stack), so it has no
  runtime effect; making it scope-aware (a `RoutingConfigSource` change threaded through its call
  sites) is left out of scope as inert.

## Related

- Feature specification: [036 Fix the operator routing status query so it honors the request scope](../sdd/036-fix-the-operator-routing-status-query-so-it-honors-the/spec.md)
- The explicit scope selector that makes a global-scope status read reachable (and reproducible): [034 Add an explicit operator scope selector so global-scoped config is reachable](../sdd/034-add-an-explicit-operator-scope-selector-so-global-scoped/spec.md)
- The `SMART_AUTHORITY` scope→authority mapping (`global:routing` / `routing`) this read reuses: [033 Add a global authority scope for the pools (role_pools) operator config](../sdd/033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md)
- The sibling WRITE-seam scope-correctness fix this READ-side change mirrors: [035 Fix a global-scope operator write also persisting a global authority into the per-project profile](../sdd/035-fix-a-global-scope-operator-write-also-persisting-a/spec.md)
- The mirrored precedent that threads the request scope into the smart/budget authority resolution: [025 Align smart and budget operator config write authority with the request scope](../sdd/025-align-smart-and-budget-operator-config-write-authority-with/spec.md)
- `routing.configure` already threads the request scope; the same seam `routing.status` was missing: [024 Implement routing.configure persistence so operator routing config persists](../sdd/024-implement-routing-configure-persistence-so-operator-routing/spec.md)
- T010 retained the `routing.status` config-backed shadow this feature makes scope-aware: [013 Wire the four remaining config-backed operator domains](../sdd/013-wire-the-four-remaining-config-backed-operator-domains-so/spec.md)

## Links

- Related: ADR-0035, ADR-0034, ADR-0024, ADR-0025.
