---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0031 — Correct The Operator Global Tui Config Precedence So

## Context and Problem Statement

ADR-0030 corrected the SERVER global config READ to layer
`base < profile < project` — `Global.Path.config` always loads, an `OPENCODE_CONFIG_DIR`
profile overrides it, and a project's `opencode.json[c]` overrides both. ADR-0030 also
flagged an explicit tracked residual: "the global TUI config
(`packages/opencode/src/config/tui.ts`) still reads its base file from the raw
`Global.Path.config` and needs the same layered treatment as a follow-up."

Feature 031 is that follow-up, and the bug it fixes is worse than the server-config gap
030 closed: it is not merely that the tui config lacked a profile layer — the profile
WAS being merged, but at the WRONG precedence. `tui.ts`'s `loadState` discovery loop
filtered `.opencode`-style directories with `dir.endsWith(".opencode") || dir ===
Flag.OPENCODE_CONFIG_DIR`, putting the profile in the SAME highest-precedence tier as
real project `.opencode` directories. Because `ConfigPaths.directories()` appends
`OPENCODE_CONFIG_DIR` last, and `mergeFile` deep-merges in iteration order (later wins),
the profile's tui config wrongly WON over a project `.opencode/tui.json` on any shared
key — the opposite of the project > profile > global-real direction ADR-0030 established
for the server config.

A second, orthogonal problem: the `configRoot() = Flag.OPENCODE_CONFIG_DIR ??
Global.Path.config` resolver existed as two separate, hand-copied definitions — one
private to `config.ts`, one private to `project-profile.ts` — with no shared source of
truth. `tui.ts` needed the same resolver for its new profile layer; adding a third
private copy would make the pattern worse, not better.

## Decision Drivers

- **Predictable precedence.** project > profile > global-real must hold for the tui
  config exactly as ADR-0030 established for the server config; the two must never
  disagree about which tui.json wins.
- **Profile stays a real override layer.** The profile must still be able to override
  the base tui config on any shared key — the fix must not simply demote it below
  everything.
- **`OPENCODE_TUI_CONFIG` escape hatch preserved.** The pre-existing explicit override
  flag must keep behaving exactly as before: it must not start losing to something it
  used to beat, or start winning against project config it used to lose to.
- **Zero default drift.** With `OPENCODE_CONFIG_DIR` unset, tui config resolution must
  be byte-for-byte identical to pre-031.
- **No double-load.** The profile's tui config must merge exactly once — dropping it
  from the `.opencode` discovery loop and adding it as its own step must not both fire.
- **DRY the resolver.** `configRoot()` must have exactly one implementation, reused by
  every seam that needs the profile-override directory.

## Considered Options

- **Option A — Give the profile its own middle layer; DRY `configRoot()` into a shared
  module (chosen).** Merge order becomes `base -> profile -> OPENCODE_TUI_CONFIG ->
  project files -> project .opencode dirs`. The `.opencode` discovery loop's filter drops
  the `OPENCODE_CONFIG_DIR` clause so it only ever sees real project directories. A new
  `config-root.ts` module exports one `configRoot()`, imported by `config.ts`,
  `project-profile.ts`, and `tui.ts`.
- **Option B — Drop the profile from tui config entirely, tell users to put tui settings
  only in the base or project tree.** Rejected: removes a working feature (profile-level
  tui overrides, e.g. a dev profile's preferred theme) rather than fixing its precedence;
  contradicts the "profile is a real override layer" driver.
- **Option C — Keep the profile in the same tier as `.opencode` dirs, but iterate it
  first instead of last.** Rejected: still couples an unrelated concept (config-root
  override) to project-tree discovery order, which is fragile to any future change in
  `ConfigPaths.directories()`'s ordering; a dedicated step is self-documenting and does
  not depend on array position.
- **Option D — Route the profile tui layer through `OPENCODE_TUI_CONFIG`-style
  single-file semantics instead of directory discovery.** Rejected: the profile can hold
  either `tui.json` or `tui.jsonc`, matching every other tier's `fileInDirectory`
  convention; forcing it through the single-file override flag would conflate two
  independent escape hatches and break `OPENCODE_TUI_CONFIG`'s own semantics.

## Decision Outcome

Chosen option: **Option A**, because it makes the tui config's precedence match the
server config's ADR-0030 model exactly, keeps the profile a genuine override layer,
preserves `OPENCODE_TUI_CONFIG`'s existing escape-hatch behavior, avoids a double-load,
and eliminates the duplicated `configRoot()` definitions in the same change. This
decision closes the tracked residual from ADR-0030.

Key decisions recorded:

1. **Profile as a dedicated middle layer (FR1, FR3).** `tui.ts`'s `loadState` merges, in
   order: base `Global.Path.config` tui config; then, when `ConfigRoot.configRoot() !==
   Global.Path.config`, the profile's tui config; then the `OPENCODE_TUI_CONFIG` file
   override if set; then project tui files (root-first); then project `.opencode`
   directory tui config (highest). Each step uses the existing `mergeFile` helper, so
   plugin-origin tracking and array/object merge semantics are unchanged.
2. **Project discovery excludes the profile (FR2).** The `.opencode`-directory filter
   drops `|| dir === Flag.OPENCODE_CONFIG_DIR`; that tier now only ever contains real
   project `.opencode` directories, closing the bug where the profile rode along in the
   highest tier and won by iteration-order accident.
3. **`OPENCODE_TUI_CONFIG` unaffected in relative position (FR4).** It keeps sitting
   above the base tier and below project discovery; inserting the profile below it (not
   above) means it now also wins over the profile — a strengthening of its escape-hatch
   role, never a weakening. No existing test asserting its behavior needed to change.
4. **No double-load (FR5).** The profile's tui config is read in exactly one place — its
   own step — because it was simultaneously removed from the `.opencode` discovery
   filter. A test with a `plugin` array (which would visibly duplicate on a double-merge)
   locks this.
5. **Zero default drift (FR6).** The profile step is guarded on `configRoot() !==
   Global.Path.config`; with the override unset that guard is false, so resolution is
   exactly the pre-031 base + project result. A test locks this.
6. **Shared `configRoot()` (FR7).** A new `packages/opencode/src/config/config-root.ts`
   module exports `ConfigRoot.configRoot()`. `config.ts` and `project-profile.ts` are
   refactored to delegate to it (`const configRoot = ConfigRoot.configRoot`) instead of
   keeping their own private copies; `tui.ts` imports it directly for its new profile
   step. This is a pure extraction — the existing 027/028/029/030 test suites pass
   unmodified, confirming no behavior drift in the two refactored callers.
7. **Plugin install targets preserved (FR8).** The directories returned from `loadState`
   for `npm.install` (`data.dirs` in the outer `layer`) are widened back to include the
   profile directory whenever it is set, so plugins declared in the profile's `tui.json`
   still get their dependencies installed even though the profile no longer shares the
   project-discovery merge tier that used to carry this side effect.
8. **Migration confirmed unaffected (FR9).** `tui-migrate.ts` iterates `directories`
   (which still includes `OPENCODE_CONFIG_DIR`) per-directory to migrate legacy
   `opencode.json` tui keys into `tui.json`; that migration is idempotent per-location and
   has no merge-order dependency, so this feature's precedence change does not touch it.
   The existing migration test suite (`test/config/tui.test.ts`) stays green unmodified,
   confirming this.

### Consequences

- Good: the tui config's precedence now matches the server config's ADR-0030 model
  (project > profile > global-real) — the two config surfaces can no longer disagree.
- Good: the profile remains a genuine override layer for tui settings, not merely
  demoted out of existence.
- Good: `OPENCODE_TUI_CONFIG`'s escape-hatch behavior is preserved and, if anything,
  strengthened (it now also wins over the profile, which it previously could lose to
  under the buggy iteration-order-dependent tier).
- Good: default (override-unset) behavior is byte-for-byte unchanged, test-locked.
- Good: the `configRoot()` resolver now has exactly one implementation, removing a
  maintenance hazard where `config.ts` and `project-profile.ts` could silently drift.
- Changed: plugins declared only in the profile's `tui.json` now get their npm install
  triggered via an explicit "profile dir" inclusion rather than incidentally riding the
  project-discovery `dirs` list — functionally identical, but the code path is now
  explicit instead of accidental.
- Closes the tracked residual from ADR-0030 ("the global TUI config ... needs the same
  layered treatment as a follow-up").

## Related

- Feature specification: [031 Correct the operator global tui config precedence so](../sdd/031-correct-the-operator-global-tui-config-precedence-so/spec.md)
- The residual this feature closes: [ADR-0030 Correct feature 028 so an opencode config dir profile layers](0030-correct-feature-028-so-an-opencode-config-dir-profile-layers.md)
- The server-config precedent this feature aligns with: [030 Correct feature 028 so an opencode config dir profile layers](../sdd/030-correct-feature-028-so-an-opencode-config-dir-profile-layers/spec.md)
- The `configRoot()` resolver origin: [028 Make the global opencode config honor the opencode config](../sdd/028-make-the-global-opencode-config-honor-the-opencode-config/spec.md)
