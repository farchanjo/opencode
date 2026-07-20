# Tasks: Correct Feature 028 So An Opencode Config Dir Profile Layers

## Task Breakdown

- [x] T001 Update the `configRoot()` doc in `config.ts` to record the Feature 030
  READ-vs-WRITE split: `configRoot()` governs the WRITE target and the profile-override
  layer; the READ base is always `Global.Path.config` (FR1, FR3).
- [x] T002 Extract `loadGlobalDir(dir, env)` from `loadGlobal` — the single-directory
  `config.json` + `opencode.json` + `opencode.jsonc` read and the legacy TOML migration,
  parameterized by directory; keep it under 30 lines (FR1, FR2).
- [x] T003 Rewrite `loadGlobal` to layer: always load the base
  `loadGlobalDir(Global.Path.config, env)`, then when `configRoot() !== Global.Path.config`
  deep-merge `loadGlobalDir(configRoot(), env)` on top via `mergeConfigConcatArrays`
  (FR1, FR2, FR4).
- [x] T004 Confirm the WRITE seams (`globalConfigFile()`, `updateGlobal`) stay on
  `configRoot()` and the directories-loop double-load guard (`dir !== configRoot()`) is
  kept so base and profile `opencode.json[c]` each load exactly once (FR3, FR6).
- [x] T005 Add the load-bearing test: base global config with a distinctive MCP server +
  a shared `model`; an `OPENCODE_CONFIG_DIR` profile overriding the shared key; assert the
  base-only server survives AND the profile override wins. Prove it fails on the 028 code
  and passes after the fix (FR1, FR2).
- [x] T006 Add the precedence test: base global authority, a profile-global override, and
  a per-project profile override; assert project > profile > global-real while base-only
  and profile-only authorities both survive (FR4).
- [x] T007 Adapt the existing Feature 028 test that assumed REPLACE semantics
  ("global config.json read resolves under OPENCODE_CONFIG_DIR") to the LAYERED model:
  the profile value still wins as an override, and the base-only key now ALSO resolves
  (FR1, FR2).
- [x] T008 Confirm credentials safety: no `auth.json` is created or relocated under the
  override; `auth.json` stays under `Global.Path.data` (FR7).
- [x] T009 Author the ADR (0030) recording the layered decision that SUPERSEDES the 028
  replace-model, and note the TUI base config as a follow-up (FR8).
- [x] T010 Run gates: `bun test test/config/ test/operator/`, `bunx tsgo --noEmit`,
  `speckit validate`, and `speckit analyze`.

## Dependencies

- Feature 028 (`028-make-the-global-opencode-config-honor-the-opencode-config`) — the
  replace-model this feature corrects.
- Feature 027 (`027-relocate-per-project-operator-persistence-out-of-the-working`) — the
  per-project profile store whose `configRoot()` pattern is reused.
- Test harness in `packages/opencode/test/config/config.test.ts`
  (`withGlobalConfigDir`, `withProcessEnv`, `tmpdirScoped`).
</content>
