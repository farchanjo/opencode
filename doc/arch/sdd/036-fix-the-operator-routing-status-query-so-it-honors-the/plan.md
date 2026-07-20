# Implementation Plan: Fix The Operator Routing Status Query So It Honors The Request Scope

## Overview

Make the config-backed `routing.status` READ honor the request scope. `routing.status` is
served by the config-status shadow (`handlersFromDomainPorts` overrides the routing domain
handler and the dispatcher resolves the handler map first), and the generic
`createConfigStatusHandler` keyed a SCOPE-BLIND authority via `authorityKeyForCommandId` — always
the project `routing` document. So `routing.status --scope global` reported `configured:false`
even with a `global:routing` document set, while `smart.status --scope global` (its real domain
port reading the effective config) correctly reported `configured:true`. This plan threads the
request scope into the `routing.status` read via the existing `SMART_AUTHORITY` SSOT
(`global` → `global:routing`, else → `routing`) and projects the redacted activation, so a scoped
`routing.status` reflects the scope's authority and agrees with `smart.status` — leaving the
generic config-status handler, the Feature 033 document-shadowing read, the routing engine
resolution, the schema, the catalog, and every write untouched.

## Technical Approach

Layer affected (a single read handler):

- **Config-backed status handler
  (`packages/opencode/src/operator/adapters/outbound/config-status.ts`).** Add a scope-aware
  `createRoutingStatusHandler(config)` that resolves its authority from `ctx.request.scope.kind`
  via `routingStatusAuthority(kind) = SMART_AUTHORITY[kind === "global" ? "global" : "project"]`
  (importing the `SMART_AUTHORITY` SSOT from `operator/smart/backend-live`, the same map
  `command-authority.ts` uses), reads `ConfigPort.get(authority)`, and returns
  `{ authority, configured, status, activation, hasPayload, ... }` where `activation` is the
  redacted `{ enabled, mode }` projection from the document payload (or `null` when absent).
  `configStatusHandlersFromPort` maps `routing.status` to this handler and REMOVES it from the
  generic `STATUS_SHOW_IDS` list (the `semantic.*` ids keep the generic scope-blind handler
  unchanged). (FR-A, FR-B)
- **No write, schema, catalog, or engine change.** The read stays a single `ConfigPort.get`; the
  Feature 033 `resolveEffective` document-shadowing read, the routing engine's effective-config
  resolution, the operator schema, the catalog, and every CAS/mutation path are untouched.
  Project/bare `routing.status` resolves `routing` exactly as before, so the config-backed
  `configured`/`authority`/`hasPayload` contract (Feature 007/013 tests) is preserved. (FR-C)
- **The shadowed domain-port `RoutingPort.status()` is left untouched.** Its
  `routing.status → RoutingPort.status()` case
  (`routing/adapters/inbound/routing-command-port.ts`) is never reached in a stack that passes a
  `ConfigPort` (every live and wired stack), so threading scope there would be inert; it is
  recorded as an accepted latent residual in ADR-0036 rather than changed. (FR-C)

Testing: a new regression in
`packages/opencode/test/operator/feature036-routing-status-scope.test.ts`, mirroring the
wired-dispatcher helpers of `feature034-explicit-scope.test.ts` (smart + budget + pools + routing
over one shared `store.config`, the production authority resolver threaded, a bound `projectId`).
It seeds ONLY a `global:routing` document (enabled + auto) and proves: `routing.status --scope
global` reports `configured:true` and `activation:{ enabled:true, mode:"auto" }`; `routing.status
--scope global` and `smart.status --scope global` agree on enabled/mode; `routing.status --scope
project` still reads `routing` and reports `configured:false`; and a bare `routing.status` still
reads `routing`. No existing assertion is weakened. (FR-D)

## Companion Artifacts

No companion files are required for this feature: it introduces no new entity, interface
contract, or external integration — it threads the request scope into one existing read handler
(`createRoutingStatusHandler`) and reuses the existing `SMART_AUTHORITY` SSOT, the config-backed
status projection, and the `ConfigPort` boundary. The optional `research.md` / `data-model.md` /
`contracts/` / `quickstart.md` are intentionally omitted (the Domain Model section in `spec.md`
carries the flow diagram).
