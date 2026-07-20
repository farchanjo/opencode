# Tasks: Operator Config Writes Must Persist Only The Project Owned

## Task Breakdown

- [x] T001 Trace and confirm the leak vector: `mergeOperator`
  (`packages/opencode/src/operator/adapters/outbound/config-service.ts`) reads the
  full effective (layered) config via `readRoot` and spreads the whole root back
  (`{ ...root, [ns]: state }`) into `Config.update`, which deep-merges it into the
  per-project profile `config.json` — copying inherited base `mcp`/`provider`
  secrets. (FR1, FR2)
- [x] T002 Narrow the write patch in `mergeOperator` to a namespaced document
  `{ $schema, [ns]: state }` for both the project (`Config.update`) and the global
  (`Config.updateGlobal`) branches, so only the `operator` namespace is persisted
  while the write seams preserve pre-existing project-owned keys. (FR1, FR3, FR6, FR7)
- [x] T003 Add the load-bearing security regression test in
  `packages/opencode/test/config/config.test.ts`: seed a base config with a fake
  secret in an `mcp` auth header, set `OPENCODE_CONFIG_DIR` to a temp profile, drive
  a real operator CAS mutation, read the RAW persisted profile file, and assert the
  secret is absent, top-level keys are limited to `{ $schema, operator }`, and the
  authority round-trips with its CAS version. Confirm it fails on pre-fix source and
  passes after. (FR2, FR4, FR5)
- [x] T004 Run the gates: `bun test test/config/ test/operator/` (green), `bunx tsgo
  --noEmit` (0 new errors), and `speckit validate`/`analyze` (ok/consistent).

## Dependencies

- Feature 030 (`030-correct-feature-028-so-an-opencode-config-dir-profile-layers`)
  introduced the layered global read that made `Config.get()` return the base
  `mcp`/`provider` secrets merged in — the precondition for the leak.
- Feature 027 (`027-relocate-per-project-operator-persistence-out-of-the-working`)
  relocated the per-project operator config to `<configRoot>/profiles/<key>/config.json`
  and owns the `projectOperatorConfigPath` helper the write targets.
- No external systems or additional team members are required.
</content>
