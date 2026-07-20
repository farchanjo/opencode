# Tasks: Add An Explicit Operator Scope Selector So Global-Scoped Config Is Reachable

## Task Breakdown

- [x] T001 Add an optional explicit `requestedKind` to the core resolver
  (`packages/core/src/operator/scope-resolve.ts`): thread it on `OperatorScopeContext`
  through `resolveOperatorScope`/`resolveScopeForCommandId`/`resolveScopeForDescriptor`, and
  resolve it to EXACTLY the requested kind (via `resolveExplicitScope`) — `forbidden_scope`
  when not allowed, else the bound ref (`global` → null) — overriding the project preference;
  absent → unchanged. (FR-A)
- [x] T002 Add the `op` CLI `--scope` flag (`packages/opencode/src/cli/cmd/op.ts`) and
  thread it into `resolveCliScope` (`cli-parse.ts`): a validated `resolveExplicitCliScope`
  forces the kind when allowed (global → ref null), rejects an unknown value or a
  conflicting different-kind ref flag, and overrides the project preference; the scope flows
  into BOTH the dispatch and the resolved read authority. (FR-B)
- [x] T003 Thread a first-class `requestedScope` through the TUI: pure metadata helpers in
  `packages/tui/src/operator/form/field-list.ts` (`isScopeFlexibleCommand`,
  `requestScopePickerOptions`, `DEFAULT_REQUEST_SCOPE`), the port types in
  `context/operator-slash.tsx`, and `executeOperatorCommand` (`operator/execute.ts`) into the
  preflight and dispatch, plus `resolveScopeForCommandId(... requestedKind)` in
  `tui-port.ts`/the slash interceptor. (FR-C)
- [x] T004 Keep the HTTP slash port payload strip and add the first-class scope
  (`packages/opencode/src/operator/adapters/inbound/http-slash-port.ts`): retain
  `delete record.scope`, thread `requestedScope` as `requestedKind` into
  `resolveScopeForCommandId` in both the preflight and the dispatch paths. (FR-D)
- [x] T005 Align the LOCAL operator principal with an explicit global request
  (`adapters/inbound/slash.ts`, `adapters/inbound/cli.ts`): build the principal AFTER scope
  resolution and set `projectBinding: null` when the resolved scope is global, so the
  fail-closed `authorizeCommand` admits it; other scopes keep the ambient binding; the remote
  principal is untouched. (FR-E)
- [x] T006 Add `test/operator/feature034-explicit-scope.test.ts` over the REAL wired
  dispatcher with a BOUND projectId, and extend the core resolver + CLI unit tests, proving
  explicit-global override to `global:routing`, the second-global CAS lockstep,
  explicit-project + default back-compat, and forbidden/unknown rejection. (FR-A, FR-B, FR-F)
- [x] T007 Author the speckit corpus (`spec.md`, `plan.md`, `tasks.md`) and
  `adr/0034-add-an-explicit-operator-scope-selector-so-global-scoped.md`, and leave the gates
  green (`bun test`, `bunx tsgo --noEmit`, `speckit validate`, `speckit analyze`).

## Dependencies

- Feature 033 (`pools.*` request-scope write authority) — made `global:routing` a valid
  pools write target; this feature makes it reachable from real frontends; already shipped.
- Feature 025 (`smart`/`budget` request-scope write authority + preflight lockstep) — the
  authority the explicit scope feeds; already shipped.
- Feature 024 (`routing.configure` persistence + shared-`routing`-document contract) — the
  request-scope persistence model; already shipped.
- Feature 021 (`command-authority.ts` SSOT + preflight CAS invariants) — preserved unchanged;
  the explicit-scope preflight rides the same authority resolver; already shipped.
- Features 030/032 (profile-global config store + project-profile vs global write) — the
  persistence targets the reachable global (`global:routing`) and project writes land on;
  inherited unchanged.
