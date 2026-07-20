# Tasks: Correct The Operator Global Tui Config Precedence So

## Task Breakdown

- [x] T001 Extract the shared `packages/opencode/src/config/config-root.ts` module
  exporting `ConfigRoot.configRoot()`, documenting it as the single resolver for the
  profile-override directory reused by `config.ts`, `project-profile.ts`, and `tui.ts`
  (FR7).
- [x] T002 Refactor `config.ts`'s private `configRoot()` to delegate to
  `ConfigRoot.configRoot()`; confirm no behavior change (FR7).
- [x] T003 Refactor `project-profile.ts`'s duplicated `configRoot()` to delegate to
  `ConfigRoot.configRoot()`; confirm no behavior change (FR7).
- [x] T004 Reposition the `OPENCODE_CONFIG_DIR` profile merge in `tui.ts` as its own
  layer: guarded on `ConfigRoot.configRoot() !== Global.Path.config`, merged via
  `mergeFile` exactly once, positioned above the base and below `OPENCODE_TUI_CONFIG` /
  project discovery (FR1, FR3, FR5).
- [x] T005 Remove `OPENCODE_CONFIG_DIR` from the project `.opencode` discovery filter and
  loop-body guard, so that tier loads only real project `.opencode` directories (FR2).
- [x] T006 Confirm `OPENCODE_TUI_CONFIG` keeps its existing win-over-base-and-profile,
  lose-to-project relative position — no regression to the escape hatch (FR4).
- [x] T007 Widen the plugin-dependency install target list (`dirs` returned from
  `loadState`) to include the profile directory when set, so profile-declared tui
  plugins still get `npm.install` runs (FR8).
- [x] T008 Confirm `tui-migrate.ts` is unaffected (it iterates `directories`
  per-directory, independent of merge order) — no code change, verified by the existing
  migration test suite staying green (FR9).
- [x] T009 Add the load-bearing precedence tests in `test/config/tui.test.ts`, each
  designed to fail under the pre-031 order: base-survives-under-profile,
  project-overrides-profile (the corrected direction), default-unset byte-for-byte
  unchanged, and profile-loads-exactly-once (no plugin-array duplication) (FR1, FR2, FR3,
  FR5, FR6).
- [x] T010 Author the ADR (0031) recording the middle-layer decision, referencing
  ADR-0030's tracked residual and Feature 028 (FR1-FR9).
- [x] T011 Run gates: `bun test test/config/ test/operator/`, `bunx tsgo --noEmit`,
  `speckit validate`, and `speckit analyze`.

## Dependencies

- Feature 030 (`030-correct-feature-028-so-an-opencode-config-dir-profile-layers`) — the
  server-config layered model this feature brings the tui config in line with, and whose
  ADR-0030 tracked this as a follow-up residual.
- Feature 028 (`028-make-the-global-opencode-config-honor-the-opencode-config`) — the
  origin of the `configRoot()` resolver pattern.
- Test harness in `packages/opencode/test/config/tui.test.ts` (`withCleanState`,
  `withEnv`, `getTuiConfig`, `getTuiPluginOrigins`) and
  `packages/opencode/test/fixture/fixture.ts` (`tmpdirScoped`).
