# Implementation Plan: Add An Explicit Operator Scope Selector So Global-Scoped Config Is Reachable

## Overview

Add an EXPLICIT request-scope selector that overrides the resolver's ambient-project
preference, so a scope-flexible command (`pools.*`/`smart.*`/`budget.*`/`routing.configure`
— all carrying the `GP` scope set) can finally request the GLOBAL authority from the real
CLI/TUI/HTTP frontends. Feature 033 made `global:routing` a valid write target, but the
resolvers prefer project whenever a project is bound — and opencode binds a project to every
directory — so global was unreachable. This plan threads an optional `requestedKind` through
the core resolver, exposes it as a CLI `--scope` flag and a first-class `requestedScope`
field on the ports/TUI, and aligns the LOCAL operator's ambient project binding with an
explicit global request so the fail-closed capability check admits it. The default (no
explicit scope) resolves exactly as before; no backend write path, the routing engine, or
the `RoutingConfig` schema changes.

## Technical Approach

Layers affected (the request-scope resolvers and the inbound ports; no backend change):

- **Core resolver (`packages/core/src/operator/scope-resolve.ts`).** Add an optional
  `requestedKind?: ScopeKind` to `OperatorScopeContext` (so it threads through
  `resolveScopeForCommandId`/`resolveScopeForDescriptor` without changing their signatures).
  In `resolveOperatorScope`, when `requestedKind` is present, resolve to EXACTLY that kind
  (via a `resolveExplicitScope` helper) — `forbidden_scope` when not in `scopesAllowed`,
  `global` → `{global,null}`, the ref-bearing kinds → their bound ref else the existing
  missing-context error. When absent, fall through to the unchanged project-preferred logic.
  (FR-A)
- **CLI (`op.ts` + `cli-parse.ts`).** Add `--scope <global|project|session|root-tree>` to
  `op.ts` and thread it into the runner flags. Add `scope?: string` to `CliParseFlags`; in
  `resolveCliScope`, an explicit `--scope` (via a `resolveExplicitCliScope` helper) validates
  the kind against the closed `ScopeKind` set, rejects a conflicting different-kind ref flag,
  enforces `scopesAllowed`, and binds the kind's ref (`global` → null), OVERRIDING the
  project preference. The explicit scope flows through `parsed.scope` into BOTH the dispatch
  and (for reads) the same resolved scope, so the CAS read authority matches the write. (FR-B)
- **TUI (`field-list.ts` + `tui-port.ts` + `execute.ts` + `operator-slash.tsx`).** Add pure
  metadata helpers (`isScopeFlexibleCommand`, `requestScopePickerOptions`,
  `DEFAULT_REQUEST_SCOPE`) that expose the request-scope options limited to a command's
  `scopesAllowed` (never a payload field). Thread an optional `requestedScope` through the
  TUI port types and `executeOperatorCommand` into the preflight AND dispatch, and into
  `resolveScopeForCommandId` as `requestedKind` (preflight path) / the slash interceptor
  (dispatch path). (FR-C)
- **HTTP slash port (`http-slash-port.ts`).** KEEP `delete record.scope` (payload strip) and
  thread the first-class `requestedScope` as `requestedKind` into `resolveScopeForCommandId`
  in both the preflight and the dispatch paths. (FR-D)
- **Local principal binding (`slash.ts` + `cli.ts`).** Build the LOCAL operator principal
  AFTER scope resolution: when the resolved scope is `global`, set `projectBinding: null` so
  the fail-closed `authorizeCommand` admits the explicit global request; other scopes keep
  the ambient binding. The server-derived remote principal is untouched. (FR-E)

Testing: a new `test/operator/feature034-explicit-scope.test.ts` drives the REAL wired
dispatcher (pools + smart + budget + routing over one shared `store.config`, production
authority resolver threaded) with a BOUND `projectId` — the exact scenario Feature 033 could
not reach — proving explicit-global persistence to `global:routing`, the second-global CAS
lockstep, explicit-project back-compat, and the default-project back-compat. The core
resolver and CLI unit tests cover `requestedKind`/`--scope` override, forbidden/unknown
rejection, and the unchanged default. (FR-F)

## Companion Artifacts

No companion files are required for this feature: it introduces no new entity, interface
contract, or external integration — it threads an optional field through the existing scope
resolver and inbound ports and reuses the existing scope value objects and routing config
domain. The optional `research.md` / `data-model.md` / `contracts/` / `quickstart.md` are
intentionally omitted (the Domain Model section in `spec.md` carries the flow diagram).
