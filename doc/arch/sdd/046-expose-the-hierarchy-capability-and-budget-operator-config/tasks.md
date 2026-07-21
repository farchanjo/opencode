# Tasks: Expose The Hierarchy Capability And Budget Operator Config

## Task Breakdown

- [x] T001 Author the shared enforcement-leaf registry
  (`packages/protocol/src/enforcement/leaves.ts`): every budget/hierarchy/capability
  leaf (key, path, label, typed constraint) plus pure validate/read/set helpers (FR1-FR4, FR9).
- [x] T002 Add the generic enforcement-leaf backend
  (`packages/opencode/src/operator/enforcement/leaf-backend.ts`): `showLeaves` projects
  the effective leaves; `planConfigure` validates + returns a CAS mutation plan that
  applies only the set leaves (FR5, FR7, FR8, FR9).
- [x] T003 Add the `hierarchy.*`/`capability.*` command adapter + stack wiring
  (`enforcement/leaf-command-port.ts`, `stack-wiring.ts`, `index.ts`) and register the new
  `hierarchy`/`capability` domains + `budget.configure` in the core catalog (bump 1.3.0 → 1.4.0).
- [x] T004 Extend the domain-port closed set (`domain-ports.ts`, `domain-stubs.ts`), the
  authority resolver (`command-authority.ts`), and `stack-live.ts` wiring for the two new
  domains and `budget.configure`; enrich `budget.show` with the full `leaves` map (FR5, FR6).
- [x] T005 Generate the TUI multi-field forms for `hierarchy.set`/`capability.set`/`budget.configure`
  from the shared registry (`field-list.ts`) and surface the domains in the operator menu
  (`palette.ts` OPERATOR_SETTINGS_DOMAINS + OPERATOR_PERSISTING_DOMAINS) (FR4, FR10).
- [x] T006 Author the spec corpus: spec.md, ADR-0046, the enforcement-leaf CUE schema, and the
  Gherkin feature file; add `packages/protocol/src/enforcement/**` to the Feature 046 guard scope.
- [x] T007 Tests: op round-trip read+write per domain, invalid-value + unknown-enum rejection,
  scope-aware (global vs project) authority, partial-write leaf preservation, and op↔TUI parity
  (`test/operator/feature046-enforcement.test.ts`, `test/operator/feature046-enforcement-parity.test.ts`);
  update pinned catalog-version/domain-count assertions to 1.4.0 / 14 domains.

## Dependencies

- Feature 007 operator control plane (registry, dispatcher, CAS `mutateAuthority`, audit sink).
- Feature 013 budget/smart/pools domain ports and the routing Config.Service authority.
- Feature 034/035 explicit `--scope` selector and project-vs-global write authority rules.
- Feature 040 TUI multi-field form + `prefillFromRead`/scope-switch re-read pattern.
