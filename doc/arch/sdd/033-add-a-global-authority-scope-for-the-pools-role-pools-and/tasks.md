# Tasks: Add A Global Authority Scope For The Pools (role_pools) Operator Config

## Task Breakdown

- [x] T001 Resolve `pools.*` scope-dependently in the wired authority resolver
  (`application/command-authority.ts`): stop short-circuiting on the static project value
  for pools, resolve `SMART_AUTHORITY[norm(scopeKind)]`, and keep pools' PROJECT-default
  entry in `staticAuthorityForCommandId` for the degraded fallback. (FR-A, FR-B)
- [x] T002 Widen the pools backend write scope (`pools/backend-live.ts`): add a per-scope
  `AUTHORITY` map + `scopeForRequest` (default `project`), replace `readProject` with
  `readScoped(scope)`, thread the scope through `planWrite`/`planSet`/`planReset`, and
  harden `apply` to merge `models.role_pools` into the FRESH `current` payload. (FR-A, FR-C)
- [x] T003 Thread the request scope through the pools ports (`pools/pools-port.ts`,
  `pools/pools-command-port.ts`): add an optional `requestScopeKind` to the `PoolsBackend`
  methods and pass `ctx.request.scope.kind` into resolve/validate/planSet/planReset. (FR-A)
- [x] T004 Confirm the CLI + TUI scope selection already covers pools (catalog `GP` +
  `resolveCliScope`/`resolveScopeForCommandId`) with no code change, and update the one
  pools backend unit-test assertion that encoded the old hardwired-project authority. (FR-F)
- [x] T005 Add `test/operator/feature033-pools-global-scope.test.ts` over the REAL wired
  dispatcher proving global persistence, project back-compat, global-governs-project,
  project-shadows-global precedence, and preflight/CAS lockstep. (FR-D, FR-E, FR-G)
- [x] T006 Author the speckit corpus (`spec.md`, `plan.md`, `tasks.md`) and
  `adr/0033-add-a-global-authority-scope-for-the-pools-role-pools-and.md`, and leave the
  gates green (`bun test`, `bunx tsgo --noEmit`, `speckit validate`, `speckit analyze`).

## Dependencies

- Feature 025 (`smart`/`budget` request-scope write authority) — the pattern and the shared
  `SMART_AUTHORITY` routing SSOT this feature mirrors for pools; already shipped.
- Feature 024 (`routing.configure` persistence) — the shared-`routing`-document coexistence
  contract and `apply(current)` merge; already shipped.
- Feature 021 (`command-authority.ts` SSOT + degraded `pools.set → "routing"` fallback) —
  preserved unchanged; already shipped.
- Features 030/032 (profile-global config store + project-profile wholesale vs global
  deep-merge write) — the persistence targets the global (`global:routing`) and project
  writes land on; inherited unchanged.
