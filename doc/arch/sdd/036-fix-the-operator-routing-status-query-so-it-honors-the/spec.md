---
id: 019f81af-3b9f-7ab3-8651-1140aa9293a9
number: 036
slug: fix-the-operator-routing-status-query-so-it-honors-the
status: analyzed
created_at: 2026-07-20T22:39:32.767302Z
---
# Feature Specification: Fix The Operator Routing Status Query So It Honors The Request Scope

Feature: 036-fix-the-operator-routing-status-query-so-it-honors-the
Created: 2026-07-20
Scope: the config-backed `routing.status` READ handler
(`packages/opencode/src/operator/adapters/outbound/config-status.ts`) that projects the
routing configuration's `configured`/activation for the operator control plane. Feature 033
maps a routing config to a per-scope Config authority (`routing` for project scope,
`global:routing` for global scope) and Feature 034 made global scope reachable from the real
CLI/TUI/HTTP frontends (`--scope global`). `smart.status`, `routing.configure`, and
`routing.test` already thread the resolved REQUEST scope into their read so they resolve the
authority matching the scope. `routing.status` did NOT: it is served by the generic
`createConfigStatusHandler` keyed on the SCOPE-BLIND `authorityKeyForCommandId`, which always
resolves the project `routing` document. So with ONLY a `global:routing` document set,
`routing.status --scope global` reported `configured:false` (and no activation) EVEN THOUGH
`smart.status --scope global` correctly reported `enabled:true, auto:true, configured:true`
from that very same `global:routing` document. This feature makes the `routing.status` read
honor the request scope — resolving `global:routing` under global scope and `routing` under
project (and bare/absent) scope, reusing the SAME `SMART_AUTHORITY` mapping Features 033/034
established — without any write, schema, catalog, or engine-resolution change.

## Audit result (grounding — every anchor verified 2026-07-20)

- **`routing.status` is served config-backed, NOT by the routing domain port.**
  `handlersFromDomainPorts` (`operator/adapters/outbound/domain-stubs.ts`) first maps every
  reserved id to the domain handler, THEN overrides `routing.status` (and the `semantic.*`
  ids) with the config-status handler (`configStatusHandlersFromPort`). The dispatcher
  resolves `handlers.get("routing.status")` FIRST (`application/dispatcher.ts`), so the
  routing domain port's `routing.status → RoutingPort.status()` case
  (`routing/adapters/inbound/routing-command-port.ts`) is SHADOWED in every stack that passes
  a `ConfigPort` — i.e. the live stack and every wired test. The read defect is in the
  config-status handler, not the domain port.
- **The config-status handler ignored the request scope.**
  `createConfigStatusHandler` resolved its authority from
  `authorityKeyForCommandId("routing.status")`. `staticAuthorityForCommandId` has no `routing`
  entry, so it fell back to the id prefix `"routing"` — the PROJECT authority, independent of
  `ctx.request.scope.kind`. So a global-scope request read the project `routing` document (as
  a global-scope request from a project directory could not have written it, that document is
  absent) and reported `configured:false`.
- **`smart.status` already honored the scope.** `smart.status` is deliberately EXCLUDED from
  the config-status shadow (Feature 013 T010) and routes through its real domain port, which
  reads the effective config (`resolveEffective`: project doc > global doc > default) and
  reports `configured: origin !== "default"`. With only `global:routing` present, the
  effective read resolves the global document, so `smart.status` reports `configured:true` —
  the parity `routing.status` broke.
- **The scope→authority mapping already exists.** `SMART_AUTHORITY`
  (`operator/smart/backend-live.ts`, mirrored by `config-adapter.ts` `AUTHORITY`) is the SSOT
  `{ global: "global:routing", project: "routing" }` that `smart`/`budget`/`pools`/
  `routing.configure` all commit through and that `command-authority.ts` imports for the
  mutation preflight. The fix reuses this map; it invents no new mapping.
- **The read is genuinely scope-blind, not merely origin-blind.** Because the config-status
  handler keys a fixed authority, no request-scope information reaches the read at all; it is
  not a shadowing/precedence question (Feature 033 document-shadowing is untouched) but a
  missing scope thread on the status read.

## Problem

`routing.status --scope global` reports `configured:false` (and null activation) when a
routing config is set at GLOBAL scope (`global:routing`), because the config-backed
`routing.status` handler resolves a SCOPE-BLIND authority (always the project `routing`
document) and ignores the request scope — while `smart.status --scope global` correctly
reports `configured:true` from the same `global:routing` document. The status read must honor
the request scope like the rest of the routing surface (`smart.status`/`routing.configure`/
`routing.test`): resolve `global:routing` under global scope and `routing` under project (and
bare) scope, reusing the established `SMART_AUTHORITY` mapping. This is a read-only fix — no
write, schema, catalog, or routing-engine change.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — A global-scope routing.status reflects the global routing document

- As an operator, I want `routing.status --scope global` to report `configured:true` and the
  global activation (`enabled` + `mode`) when a `global:routing` document is set, so that the
  status I read matches what I configured and what `smart.status --scope global` reports.

### P1 — routing.status agrees with smart.status at the same scope

- As an operator, I want `routing.status --scope global` and `smart.status --scope global` to
  agree on the activation (`enabled` + mode/`auto`) for the same `global:routing` document, so
  the two operator surfaces never disagree about whether Smart Routing is configured/enabled.

### P2 — Project-scope and bare routing.status are unchanged (back-compat)

- As a maintainer, I want `routing.status --scope project` and a bare `routing.status` (no
  explicit scope) to read the project `routing` authority exactly as before, so every existing
  caller and test behaves identically and the change is strictly additive on the project path.

### P2 — No write, schema, catalog, or engine-resolution change

- As a maintainer, I want the fix confined to the status READ authority resolution, with no
  change to any write, the routing config schema, the catalog, the Feature 033
  document-shadowing precedence, or the routing engine's own effective-config resolution, so
  the blast radius is one read handler.

## Functional Requirements

### Group A — the routing.status read resolves the authority by request scope (FR-A)

1. **FR-A — `routing.status` resolves `global:routing` under global scope, `routing`
   otherwise.** The config-backed `routing.status` handler
   (`operator/adapters/outbound/config-status.ts`) MUST resolve its Config authority from
   `ctx.request.scope.kind` via the shared `SMART_AUTHORITY` SSOT: `global` → `global:routing`,
   every other kind (`project`/`session`/absent) → `routing`. It MUST NOT introduce a new
   scope→authority mapping. The read stays a single `ConfigPort.get(authority)`; no write, CAS,
   or mutation is performed.

### Group B — the scoped status projects the redacted activation (FR-B)

2. **FR-B — the scoped read projects `configured` + redacted activation (enabled + mode).**
   The handler MUST report `configured` (authority document present), `status`
   (`configured`/`unconfigured`), the resolved `authority`, and a redacted `activation`
   projection (`enabled` + `mode`, or `null` when the authority holds no document). Only the
   activation flags are surfaced — never the raw payload — so a scoped `routing.status` agrees
   with `smart.status` on `enabled`/`mode` without dumping configuration or secrets.

### Group C — project/bare reads and everything else are unchanged (FR-C)

3. **FR-C — project/bare `routing.status` and all non-routing behavior are unchanged.** A
   `routing.status --scope project` and a bare `routing.status` (no explicit scope, project
   bound) MUST still resolve the project `routing` authority and report the same
   `configured`/`authority`/`hasPayload` fields as before. The generic
   `createConfigStatusHandler` (still serving the `semantic.*` ids), the Feature 033
   document-shadowing read (`resolveEffective`), the routing engine's effective-config
   resolution, the operator schema, the catalog, and every write path MUST be byte-for-byte
   unchanged.

### Group D — regression proof over the wired dispatcher (FR-D)

4. **FR-D — the scope-honoring read is proven over the real wired dispatcher.** Regression
   coverage MUST drive the SAME wired dispatcher the TUI uses (smart + budget + pools + routing
   over one shared `store.config`, the production authority resolver threaded) with a bound
   `projectId`, and prove: (a) with only `global:routing` present, `routing.status --scope
   global` reports `configured:true` and the global activation (`enabled` + `mode`); (b)
   `routing.status --scope global` and `smart.status --scope global` agree on enabled/mode;
   (c) `routing.status --scope project` still reads the project `routing` authority and reports
   `configured:false` when absent; (d) a bare `routing.status` still reads the project `routing`
   authority. No existing assertion is weakened.

## Non-Functional Requirements

- **Minimal read-seam threading, no new store or mapping.** The change threads the request
  scope into one status read via the existing `SMART_AUTHORITY` SSOT; it adds no parallel
  store, port, schema, or scope→authority mapping.
- **One scope→authority SSOT.** The status read and the write-routing/preflight both key on
  `SMART_AUTHORITY`; no parallel definition of the routing authority per scope is introduced.
- **No contract, catalog, or dispatch change.** No operator payload shape, command id, catalog
  version, dispatch path, server/port surface, or feature flag is added or altered.
- **Zero provider/model cost.** The read is model-independent and offline-capable; it makes no
  provider/model calls, consumes no tokens, and incurs no cost.
- **Honest projection.** The read surfaces only `configured` + redacted activation; an absent
  authority document reports `configured:false` with `activation:null` — never a fabricated
  configured state.

## Security Requirements

- **Data sensitivity/classification.** This feature reads the routing configuration document
  under the `routing` / `global:routing` Config authorities — operator configuration metadata
  (activation flags, routing bindings), not end-user content or credentials. It surfaces ONLY
  the redacted activation projection (`enabled` + `mode`, both non-secret flags the
  `smart.status` summary already exposes) plus `configured`/`authority`; it never dumps the raw
  payload. No credential or token is read, written, or exposed.
- **Authentication/authorization.** No new authenticated surface, credential, or permission
  boundary. The read rides the existing Feature 007 operator principal, scope-authorization
  matrix, and command catalog unchanged — a project-bound principal still cannot target global
  scope without an explicit, authorized request scope (Feature 034). The fix only corrects
  WHICH authority document the already-authorized read consults, honoring the request scope
  that authorization already validated.
- **Input validation.** The untrusted input is unchanged (the operator command envelope
  validated by the dispatcher). The handler classifies `ctx.request.scope.kind` with the closed
  `global`-vs-else predicate and reads a fixed authority key; it parses no new untrusted input,
  and the activation projection reads only two typed flags from an already-persisted document,
  defaulting safely (`enabled:false`, `mode:"never"`) on any malformed field.
- **Cryptography in transit/at rest.** Not applicable — this feature reads through the existing
  `ConfigPort.get` boundary; it introduces no new data-in-transit path and no new at-rest
  requirement, and it NARROWS what a scoped read exposes (redacted activation only).
- **Logging/audit.** No new logging. The read projects through the existing Feature 007 query
  audit path unchanged; no authority payload is carried into a log line.
- **Error-handling information exposure.** The read reports a bounded status projection
  (`configured`/`status`/`authority`/`activation`); an absent document is the honest
  `unconfigured`/`configured:false` state, never a stack trace or a raw config fragment. The
  scope resolution cannot fail (a closed `global`-vs-else branch), so it adds no new error path.

## Acceptance Scenarios

Given the operator control plane is enabled and a wired dispatcher (smart + budget + pools +
routing over one shared `store.config`) with a bound `projectId`

- **A global-scope routing.status reflects the global routing document (FR-A, FR-B, FR-D-a).**
  Given ONLY a `global:routing` document is set (enabled + auto, no project `routing`),
  When `routing.status --scope global` is read,
  Then it reports `authority:"global:routing"`, `configured:true`, and
  `activation:{ enabled:true, mode:"auto" }`.

- **routing.status agrees with smart.status at global scope (FR-B, FR-D-b).**
  Given the same `global:routing` document,
  When `routing.status --scope global` and `smart.status --scope global` are read,
  Then they agree: `activation.enabled === smart.enabled` and
  `(activation.mode === "auto") === smart.auto`, with `smart.configured:true`.

- **A project-scope routing.status is unchanged (FR-C, FR-D-c).** _[Superseded by Feature 040 /
  ADR-0040]_ — the project/bare read now SHADOWS the global config via the layered effective read.
  Given only a `global:routing` document is set,
  When `routing.status --scope project` is read,
  Then (Feature 036) it reported `authority:"routing"`, `configured:false`,
  `status:"unconfigured"`, `activation:null`; (Feature 040, current) it reports
  `authority:"routing"`, `configured:true`, `status:"configured"`, and the shadowed
  `activation:{ enabled, mode }`, agreeing with `smart.status --scope project`.

- **A bare routing.status stays project (FR-C, FR-D-d).** _[Superseded by Feature 040 /
  ADR-0040]_ — a bare read now shadows the global config too.
  Given only a `global:routing` document is set and a project is bound,
  When a bare `routing.status` (no explicit scope) is read,
  Then (Feature 036) it reported `authority:"routing"` and `configured:false`; (Feature 040,
  current) it reports `authority:"routing"`, `configured:true`, and the shadowed activation.

## Observability

This is a read-handler authority-resolution fix with no new backend surface, so it emits no new
metrics, log events, or trace spans. Operator queries project through the existing Feature 007
query audit and the ADR-0001 OTLP foundation with content-free, bounded labels (command id,
domain, surface, outcome) — unchanged, because the payload contract and dispatch path are
unchanged. The behavioral change is only WHICH authority document a scoped `routing.status`
read consults (now the request scope's authority). Conventions live in
`doc/arch/observability/observability.md`.

## Domain Model

The fix reuses the existing config-backed status handler and the `SMART_AUTHORITY` SSOT; no new
schema shape is introduced. The corrected flow:

```
routing.status --scope global   (ctx.request.scope.kind = "global")
        |
        v
config-status routing.status handler
  authority = SMART_AUTHORITY[kind === "global" ? "global" : "project"]      (FR-A)
    global  -> "global:routing"
    project -> "routing"   (also bare / session / absent)
        |
        v
ConfigPort.get(authority)   (read-only; NO write, NO CAS)
  entry present -> configured:true,  activation = { enabled, mode }          (FR-B)
  entry absent  -> configured:false, activation = null
        |
        v
parity: for the same global:routing document, routing.status --scope global
  and smart.status --scope global agree on enabled/mode                      (FR-B)
document-shadowing read (resolveEffective), engine resolution, writes: UNCHANGED (FR-C)
```

## Out of Scope

- **Changing the write, the routing config schema, the catalog, or the routing engine's
  effective-config resolution** — this is a read-only authority-resolution fix.
- **Altering the Feature 033 document-shadowing precedence (`resolveEffective`: project doc >
  global doc > default)** — the fix threads the request scope into the status read; it does not
  touch effective-config shadowing.
- **Moving `routing.status` off the config-status shadow onto the routing domain port** — the
  shadow is a deliberate, test-locked contract (Feature 013 T010); the fix makes the shadow
  scope-aware rather than removing it, so the config-backed `configured`/`authority` projection
  stays intact.
- **Threading the request scope into the (shadowed) `RoutingPort.status()` domain-port case** —
  that path is never reached in a stack that passes a `ConfigPort` (every live and wired stack),
  so changing it would be inert; noted as a latent, accepted residual in ADR-0036.
- **Any operator payload, command id, catalog version, dispatch path, or feature flag change** —
  only the `routing.status` read-authority resolution changes.

## Related Features and Decisions

- [ADR-0036 — Fix the operator routing status query so it honors the request scope](../../adr/0036-fix-the-operator-routing-status-query-so-it-honors-the.md)
- [Feature 034 — Add an explicit operator scope selector so global-scoped config is reachable](../034-add-an-explicit-operator-scope-selector-so-global-scoped/spec.md) — the explicit `--scope global` selector that makes a global-scope status read reachable and reproducible.
- [Feature 033 — Add a global authority scope for the pools (role_pools) operator config](../033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md) — the `SMART_AUTHORITY` scope→authority mapping (`global:routing` / `routing`) this read reuses.
- [Feature 035 — Fix a global-scope operator write also persisting a global authority into the per-project profile](../035-fix-a-global-scope-operator-write-also-persisting-a/spec.md) — the sibling scope-correctness fix on the WRITE seam; this feature is its READ-side counterpart.
- [Feature 025 — Align smart and budget operator config write authority with the request scope](../025-align-smart-and-budget-operator-config-write-authority-with/spec.md) — the mirrored precedent that threads the request scope into the smart/budget authority resolution.
- [Feature 024 — Implement routing.configure persistence so operator routing config persists](../024-implement-routing-configure-persistence-so-operator-routing/spec.md) — `routing.configure` already threads the request scope; the same seam `routing.status` was missing.
- [Feature 013 — Wire the four remaining config-backed operator domains](../013-wire-the-four-remaining-config-backed-operator-domains-so/spec.md) — T010 retained the `routing.status` config-backed shadow this feature makes scope-aware.

## Clarifications

### Session 2026-07-20

- **The defect is a scope-blind config-status read, not the routing domain port (FR-A).**
  `routing.status` is served by the config-status shadow (`handlersFromDomainPorts` overrides the
  domain handler); the handler keyed a fixed project `routing` authority via
  `authorityKeyForCommandId`, ignoring `ctx.request.scope.kind`. Recorded in ADR-0036.
- **The fix reuses the `SMART_AUTHORITY` SSOT (FR-A).** The scoped read resolves `global:routing`
  under global scope and `routing` otherwise via the same map `smart`/`budget`/`pools`/
  `routing.configure` and the mutation preflight use. Recorded in ADR-0036.
- **The scoped read projects redacted activation for parity (FR-B).** It surfaces `enabled` +
  `mode` (non-secret flags `smart.status` already exposes) so a scoped `routing.status` agrees
  with `smart.status`; the raw payload is never dumped. Recorded in ADR-0036.
- **Project/bare reads and all writes are unchanged (FR-C).** No change to the generic
  config-status handler (still serving `semantic.*`), `resolveEffective` document-shadowing, the
  operator schema, the catalog, or any write. Recorded in ADR-0036.
- **The shadowed domain-port `RoutingPort.status()` is left untouched (accepted residual).**
  It is never reached in a stack that passes a `ConfigPort`, so threading scope there would be
  inert; noted as a latent residual in ADR-0036 rather than fixed. Recorded in ADR-0036.
