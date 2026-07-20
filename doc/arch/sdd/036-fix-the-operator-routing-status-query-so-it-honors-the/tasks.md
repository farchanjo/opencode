# Tasks: Fix The Operator Routing Status Query So It Honors The Request Scope

## Task Breakdown

- [x] T001 Confirm the root cause by reading the code and driving the wired dispatcher:
  `routing.status` is served by the config-status shadow (`handlersFromDomainPorts` overrides the
  routing domain handler; the dispatcher resolves the handler map first), and
  `createConfigStatusHandler` keys a SCOPE-BLIND authority via `authorityKeyForCommandId` →
  project `routing` — so `routing.status --scope global` reads the absent project document and
  reports `configured:false`, while `smart.status --scope global` reads the effective config and
  reports `configured:true` from the same `global:routing` document. The routing domain port's
  `routing.status → RoutingPort.status()` case is shadowed (never reached with a `ConfigPort`).
- [x] T002 Thread the request scope into the `routing.status` read
  (`operator/adapters/outbound/config-status.ts`): add `createRoutingStatusHandler(config)` that
  resolves the authority from `ctx.request.scope.kind` via the shared `SMART_AUTHORITY` SSOT
  (`global` → `global:routing`, else → `routing`), reads `ConfigPort.get(authority)`, and maps
  `routing.status` to it in `configStatusHandlersFromPort` (removed from the generic
  `STATUS_SHOW_IDS`; the `semantic.*` ids keep the generic handler). (FR-A)
- [x] T003 Project the redacted activation: the scoped read returns `configured`/`status`/
  `authority`/`hasPayload` plus `activation` = `{ enabled, mode }` from the document payload
  (or `null` when absent) — only the non-secret activation flags, never the raw payload — so a
  scoped `routing.status` agrees with `smart.status` on enabled/mode. (FR-B)
- [x] T004 Preserve project/bare reads and everything else: a `--scope project` and a bare
  `routing.status` still resolve the project `routing` authority and report the same
  `configured`/`authority`/`hasPayload` fields; the generic config-status handler
  (`semantic.*`), `resolveEffective` document-shadowing, the routing engine resolution, the
  schema, the catalog, and every write are unchanged. (FR-C)
- [x] T005 Add the regression to
  `packages/opencode/test/operator/feature036-routing-status-scope.test.ts` (mirroring
  `feature034-explicit-scope.test.ts`) over the wired dispatcher with a bound `projectId`: prove
  `routing.status --scope global` reports `configured:true` + `activation:{ enabled:true,
  mode:"auto" }` with only `global:routing` present, that `routing.status`/`smart.status` agree
  at global scope, that `--scope project` still reads `routing` (`configured:false`), and that a
  bare `routing.status` still reads `routing`. No existing assertion is weakened. (FR-D)
- [x] T006 Author the speckit corpus (`spec.md`, `plan.md`, `tasks.md`) and
  `adr/0036-fix-the-operator-routing-status-query-so-it-honors-the.md`, and leave the gates green
  (`bun test test/operator/ test/routing/ test/config/`, `bunx tsgo --noEmit`, `speckit
  validate`, `speckit analyze`).

## Dependencies

- Feature 033 (`SMART_AUTHORITY` scope→authority mapping `global:routing` / `routing`) — the SSOT
  this read reuses; already shipped.
- Feature 034 (explicit `--scope global` selector) — makes a global-scope status read reachable
  and reproducible; already shipped.
- Feature 024 / 025 (`routing.configure` / smart+budget request-scope threading) — the mirrored
  precedent that threads the request scope into the authority resolution; already shipped.
- Feature 013 (T010 retained the `routing.status` config-backed shadow) — the handler this
  feature makes scope-aware; inherited unchanged.
- Feature 035 (the WRITE-seam scope-correctness fix) — the sibling this READ-side fix mirrors;
  already shipped.
