---
status: accepted
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0030 — Correct Feature 028 So An Opencode Config Dir Profile Layers

## Context and Problem Statement

Feature 028 aligned the GLOBAL config seams onto a single operative resolver,
`configRoot() = Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config`, so an isolated
profile would own its global config too (not just its Feature 027 `profiles/` tree).
But it applied that resolver to the global config READ as a REPLACE: when
`OPENCODE_CONFIG_DIR` is set, `loadGlobal()` reads `config.json` / `opencode.json[c]`
ONLY from the override and never from `Global.Path.config`.

That breaks a real workflow. A user runs opencode with
`OPENCODE_CONFIG_DIR=~/.opencodedev` — an isolated profile that holds only a minimal
`config.json` — while their real global config (MCP servers, model, plugins) lives in
`~/.config/opencode/opencode.jsonc`. Post-028 the global read looks only at
`~/.opencodedev`, so the real config stops loading and opencode breaks. The confirmed
desired model is LAYERED (inherit), not replace: the override should ADD to the base,
never drop it.

The question: how to make `OPENCODE_CONFIG_DIR` layer its global config ON TOP of the
real global default — without changing default (override-unset) behavior, without
inverting the project-over-profile-over-global precedence, without re-loading the
profile files twice, and without touching auth material.

## Decision Drivers

- **Base must never drop.** The real global config at `Global.Path.config` must ALWAYS
  load, so setting `OPENCODE_CONFIG_DIR` never silently strips a user's MCP servers,
  model, or plugins.
- **Profile layers as an override.** The isolated profile must be able to add or replace
  individual global keys without re-declaring the whole global config.
- **Predictable precedence.** project > profile > global-real must hold on any
  overlapping key.
- **Zero default drift.** With the override unset, global resolution must be byte-for-byte
  identical to pre-030.
- **No double-load.** Base and profile `opencode.json[c]` must each merge exactly once, at
  the correct precedence.
- **Credentials untouched.** The change must confine itself to config-file resolution and
  never relocate, read, write, or expose auth material.

## Considered Options

- **Option A — Layered read: base `Global.Path.config` always, profile `configRoot()`
  merged on top; write stays on `configRoot()` (chosen).** `loadGlobal()` always loads the
  base dir, then when `configRoot() !== Global.Path.config` deep-merges the profile dir on
  top with the existing concat/dedupe array semantics. The write target and the
  directories-loop double-load guard are unchanged.
- **Option B — Keep 028 replace, tell users to copy their global config into the profile.**
  Rejected: it makes an isolated profile a full duplicate of the global config, defeats the
  "add/override" intent, and drifts silently whenever the real global config changes.
- **Option C — Merge base under profile only for `config.json`, leave `opencode.json[c]`
  replaced.** Rejected: half-layered is as confusing as 028 was half-honored; MCP/model
  live in `opencode.jsonc` for most users, exactly the file that must survive.
- **Option D — Relocate auth alongside the config, or read auth from the profile.**
  Rejected and explicitly out of scope: auth material is credential-sensitive, lives under
  `Global.Path.data`, and is a separate, higher-risk decision. This feature guarantees auth
  is untouched.

## Decision Outcome

Chosen option: **Option A**, because it restores the base global config the user depends
on while letting the profile layer on top as an override, keeps default behavior
byte-for-byte unchanged, preserves project > profile > global-real precedence, and avoids
a double-load — all while leaving auth material untouched. This decision SUPERSEDES the
Feature 028 replace-model for the global config READ; the WRITE model from 028 is retained.

**Refinement note (cross-reference):** ADR-0030 refines and supersedes
[ADR-0028](0028-make-the-global-opencode-config-honor-the-opencode-config.md) for the
global config READ specifically. ADR-0028 established `configRoot()` as the single
operative resolver and is still the governing mandate for the global config WRITE target
(`updateGlobal`, `globalConfigFile()`) and for the directories-loop double-load guard;
ADR-0030 governs the READ path only, replacing ADR-0028's REPLACE semantics there with the
LAYERED (base-always, profile-overrides) semantics described above.

Key decisions recorded:

1. **Layered READ, base always loads (FR1/FR2).** `loadGlobal()` always reads the base
   dir `Global.Path.config`; when `configRoot()` differs it deep-merges the profile dir on
   top via `mergeConfigConcatArrays`, so scalar keys override, nested objects (MCP,
   provider, operator authorities) deep-merge (base survives), and arrays such as
   `instructions` concat/dedupe consistent with the global↔local merge. The single-directory
   load is factored into a `loadGlobalDir(dir, env)` helper so both layers share one code
   path and each method stays under 30 lines.
2. **WRITE stays on `configRoot()` (FR3).** `globalConfigFile()` and `updateGlobal` are
   unchanged, so the profile captures global-config changes without mutating the real
   global dir; with the override unset the write lands in `Global.Path.config`.
3. **Precedence (FR4).** project > profile > global-real. The profile wins over the base by
   being merged on top inside `loadGlobal`; project-tree `opencode.json[c]` and the
   per-project operator namespace (Feature 027) are merged after the whole global layer
   (local scope), so project wins over both. A test proves a per-project profile authority
   overrides a profile-global authority, which overrides a base authority, while base-only
   and profile-only authorities both still resolve.
4. **Zero default drift (FR5).** When `OPENCODE_CONFIG_DIR` is unset, `configRoot() ===
   Global.Path.config`, so there is no second layer and the read is byte-for-byte the
   pre-030 behavior. An existing test locks this (`with no override, the global config
   resolves from Global.Path.config`).
5. **No double-load (FR6).** The directories loop already skips the config-root file-load
   via `dir !== configRoot()`. `Global.Path.config` is naturally excluded there too — it is
   neither a `.opencode` dir nor `Flag.OPENCODE_CONFIG_DIR` — so both the base and profile
   `opencode.json[c]` load exactly once, through `loadGlobal`. No guard edit was needed; a
   test proves no plugin array duplication.
6. **Credentials-safety finding (FR7, invariant).** Auth material is untouched. The auth
   store resolves from `Global.Path.data` (`path.join(Global.Path.data, "auth.json")` in
   `src/auth/index.ts`), out of the config root; it never reads `OPENCODE_CONFIG_DIR`. Every
   seam touched here concerns `config.json` / `opencode.json[c]` resolution only. A test
   confirms no `auth.json` is created or relocated under the override.
7. **Scope boundary (FR8).** Project-tree discovery, the Feature 027 per-project profile
   helper, and the `OPENCODE_DISABLE_PROJECT_CONFIG` gate are unchanged.

### Consequences

- Good: setting `OPENCODE_CONFIG_DIR` no longer breaks opencode — the real global config
  keeps loading as the base, and the isolated profile layers its own keys on top.
- Good: default behavior is byte-for-byte unchanged (`configRoot() === Global.Path.config`
  when the override is unset), so existing users see no change.
- Good: precedence is predictable and test-locked — project > profile > global-real.
- Good: the base/profile `opencode.json[c]` double-load is avoided; the existing guard and
  merge/dedupe logic already prevent array duplication.
- Good: auth material is provably untouched — credentials stay under `Global.Path.data`.
- Changed (supersedes 028): the global READ is now layered rather than replaced. Relative to
  028, an isolated profile's config no longer stands alone; it inherits the base. The 028
  test that asserted the profile REPLACES the base is adapted to assert the profile OVERRIDES
  while the base survives.
- Out of scope (tracked residual): the global TUI config
  (`packages/opencode/src/config/tui.ts`) still reads its base file from the raw
  `Global.Path.config` and needs the same layered treatment as a follow-up; it has its own
  `OPENCODE_TUI_CONFIG` override flag and is not addressed here.

## Related

- Feature specification: [030 Correct feature 028 so an OPENCODE_CONFIG_DIR profile layers](../sdd/030-correct-feature-028-so-an-opencode-config-dir-profile-layers/spec.md)
- The replace-model this feature corrects: [028 Make the global opencode config honor the opencode config](../sdd/028-make-the-global-opencode-config-honor-the-opencode-config/spec.md)
- The per-project relocation that introduced the `configRoot` pattern: [027 Relocate per-project operator persistence out of the working tree](../sdd/027-relocate-per-project-operator-persistence-out-of-the-working/spec.md)
</content>

## Links

- Status: **accepted**. Supersedes ADR-0028 for the global config READ model (layer over replace).
- Related: ADR-0031 (extends layering to TUI config), ADR-0032 (project-owned write isolation), ADR-0027 (configRoot / profiles).
