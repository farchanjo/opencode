# Tasks: Fix A Global-Scope Operator Write Also Persisting A Global Authority Into The Per-Project Profile

## Task Breakdown

- [x] T001 Confirm the root cause by reading the code: `mergeOperator` routes the global
  authority CAS to `Config.updateGlobal` (single-file), while the project-scoped bookkeeping
  stores (idempotency/rollback/audit-outbox, `metaAuth() === "project"`) read the LAYERED
  `Config.get()` (Feature 030 merges the global doc's operator namespace under the profile,
  `config.ts` ~lines 522–548) and REPLACE-write the whole namespace into the per-project
  profile — leaking `global:routing` (finalize `idempotency.put`, cutover `rollback.set`).
- [x] T002 Filter non-project-owned authorities out of the project write
  (`operator/adapters/outbound/config-service.ts`): add a pure `projectOwnedAuthorities`
  helper keyed on the existing `isGlobalAuthority` SSOT, and in `mergeOperator` persist
  `{ ...state, authorities: projectOwnedAuthorities(state.authorities) }` on the project
  (non-global) branch while leaving the global branch (`Config.updateGlobal` deep-merge)
  unchanged. (FR-A)
- [x] T003 Preserve the project-owned bookkeeping: the filter narrows ONLY `state.authorities`;
  `idempotency`, `rollback`, and `auditOutbox` persist to the profile as before, so a
  re-issued global command still dedups and rollback still round-trips. (FR-B)
- [x] T004 Add the regression to `packages/opencode/test/config/config.test.ts` (the sibling
  home of the Feature 032 leak test) over the REAL `Config.Service` with `OPENCODE_CONFIG_DIR`
  set: prove the profile has no `global:*` authority after a global mutation + its bookkeeping
  (idempotency record present), the global document reaches `cas_v2` on a second save with the
  profile still clean (stale-copy regression), a `--scope project` write still writes only the
  project `routing` authority, and idempotency replays a re-issued global command. (FR-D)
- [x] T005 Author the speckit corpus (`spec.md`, `plan.md`, `tasks.md`) and
  `adr/0035-fix-a-global-scope-operator-write-also-persisting-a.md`, and leave the gates green
  (`bun test test/operator/ test/config/`, `bunx tsgo --noEmit`, `speckit validate`,
  `speckit analyze`).

## Dependencies

- Feature 032 (`{ replace: true }` project-profile write + "persist only what the file owns")
  — the sibling class-of-defect and the write path this fix narrows further; already shipped.
- Feature 030 (layered `Config.get()` that merges the global operator namespace into the
  project effective config) — the leak vector; inherited unchanged.
- Feature 033 (`global:routing` scope→authority mapping) — the authority this feature scopes
  off the profile; already shipped.
- Feature 034 (explicit `--scope global` selector + global CAS lockstep) — makes the global
  write path reachable/reproducible and the CAS invariant this fix preserves; already shipped.
- Feature 027 (per-project profile relocation) — owns the leaked write target; inherited
  unchanged.
</content>
