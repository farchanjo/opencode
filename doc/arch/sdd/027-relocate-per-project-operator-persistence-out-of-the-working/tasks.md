# Tasks: Relocate Per Project Operator Persistence Out Of The Working

## Task Breakdown

- [x] T001 Add `config/project-profile.ts` with the pure `encodeProjectPathKey`,
  the `projectProfileDir` helper (anchored on `Global.Path.config`, resolving the
  input via `Filesystem.resolve`), and `projectOperatorConfigPath`.
- [x] T002 Unit-test `encodeProjectPathKey` in
  `test/config/project-profile.test.ts` (canonical example, leading-separator
  drop, sanitization, hostile segments, Windows separators, collision trade-off).
- [x] T003 Relocate the read seam in `config.ts` `loadInstanceState` to
  `ProjectProfile.projectOperatorConfigPath(ctx.directory)`.
- [x] T004 Add the non-destructive migration read-through: fall back to the legacy
  `<projectDir>/config.json` operator namespace when the relocated one is absent,
  and emit a one warning naming both paths (no auto-delete).
- [x] T005 Relocate the write seam in `Config.update` to
  `ProjectProfile.projectOperatorConfigPath(dir)` using `fs.writeWithDirs` so the
  `profiles/<key>/` directory is created recursively.
- [x] T006 Update the existing config tests that assert the in-tree path to assert
  the relocated profile path (empty-shell sentinel, Feature 014 T013, update-write).
- [x] T007 Add integration tests: relocation round-trip (out of tree), migration
  read-through with legacy file left intact, and `OPENCODE_DISABLE_PROJECT_CONFIG`
  skip.
- [x] T008 Author the ADR (0027) recording the readability-vs-collision trade-off
  and the non-destructive-migration decision; keep spec/plan/tasks in sync.
- [x] T009 Run gates: `bun test test/config/ test/operator/`, `bunx tsc --noEmit`
  (0 new errors), `speckit validate` (ok), `speckit analyze` (consistent).

## Dependencies

- T003–T005 depend on T001 (the helper module).
- T006–T007 depend on T003–T005 (the seams under test).
- The migration read-through (T004) reuses the existing `loadOperatorNamespace`
  loader and the `!Flag.OPENCODE_DISABLE_PROJECT_CONFIG` gate; no new external
  systems or services are required.
