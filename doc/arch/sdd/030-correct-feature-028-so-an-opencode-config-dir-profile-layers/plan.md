# Implementation Plan: Correct Feature 028 So An Opencode Config Dir Profile Layers

## Overview

Feature 028 made the GLOBAL config READ resolve solely from `configRoot() =
Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config`, which REPLACES the base. A user who
runs with `OPENCODE_CONFIG_DIR` pointed at an isolated profile (holding only a minimal
`config.json`) then loses their real global config at `~/.config/opencode` (MCP servers,
model, plugins) — opencode breaks. This plan corrects 028 to a LAYERED model: the base
global dir always loads, and the profile layers on top as an override
(project > profile > global-real). The WRITE target stays on `configRoot()` (028
behavior). Default-unset behavior is byte-for-byte unchanged.

## Technical Approach

All changes are confined to `packages/opencode/src/config/config.ts`. The READ seams
that Feature 028 routed through `configRoot()` are split so the READ becomes layered
while the WRITE stays put:

- **`configRoot()` doc (unchanged behavior).** `configRoot()` keeps returning
  `Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config`. Its doc is updated to state that it
  now governs the WRITE target and the profile-override layer only — the READ base is
  always `Global.Path.config`.
- **Extract `loadGlobalDir(dir, env)`.** Factor the single-directory global load (the
  `config.json` + `opencode.json` + `opencode.jsonc` reads and the legacy TOML migration)
  out of `loadGlobal`, parameterized by directory. Methods stay < 30 lines.
- **Rewrite `loadGlobal` as layered.** Always `loadGlobalDir(Global.Path.config, env)`
  for the base; then, when `configRoot() !== Global.Path.config`, deep-merge
  `loadGlobalDir(configRoot(), env)` on top via `mergeConfigConcatArrays` (same array
  semantics as the global↔local merge). The seed-for-editor-completion block is unchanged.
- **Keep the write seams on `configRoot()`.** `globalConfigFile()` and `updateGlobal`
  are untouched, so the profile still captures global writes.
- **Double-load guard unchanged.** The directories loop already skips the config-root
  file-load via `dir !== configRoot()`; `Global.Path.config` is naturally excluded there
  (it is neither a `.opencode` dir nor `Flag.OPENCODE_CONFIG_DIR`), so both base and
  profile `opencode.json[c]` load exactly once — through `loadGlobal`. No guard edit.
- **Precedence.** Project-tree `opencode.json[c]` and the per-project operator namespace
  are merged after the global layer (local scope), so project wins over both profile and
  base; the profile wins over the base by being merged on top inside `loadGlobal`.

Verification is a load-bearing test in `test/config/config.test.ts` that fails on the
028 (replace) code and passes after the fix: a base global config with a distinctive
MCP server plus a shared `model`, an `OPENCODE_CONFIG_DIR` profile that overrides the
shared key, asserting the base-only key survives AND the profile override wins; a second
test proves project > profile > global-real on a shared operator authority. The 028 test
that assumed replace semantics is adapted to the layered assertions.

## Companion Artifacts

No companion files are needed for this correction. The change is a localized loader
refactor with test coverage; the CUE schema and Gherkin `.feature` scaffolds are left as
placeholders, matching features 024-029.
</content>
