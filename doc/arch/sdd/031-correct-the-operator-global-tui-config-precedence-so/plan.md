# Implementation Plan: Correct The Operator Global Tui Config Precedence So

## Overview

Feature 030 corrected the SERVER global config READ to layer
(`base < profile < project`) but left the residual noted in ADR-0030: the TUI config
loader (`packages/opencode/src/config/tui.ts`) still merged the `OPENCODE_CONFIG_DIR`
profile inside the SAME highest-precedence tier as project `.opencode` directories.
Because `OPENCODE_CONFIG_DIR` was appended last in the directories list, the profile
wrongly won over a project `.opencode` tui config — the opposite of the corrected
project > profile > global-real direction. This plan repositions the profile as its own
middle layer (above the base, below project discovery) and DRYs the `configRoot()`
resolver that was duplicated between `config.ts` and `project-profile.ts` into one
shared module reused by all three seams.

## Technical Approach

Two changes, both confined to `packages/opencode/src/config/`:

- **New shared module `config-root.ts`.** Extracts `configRoot() =
  Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config` — previously defined once in
  `config.ts` and copied in `project-profile.ts` — into a single exported
  `ConfigRoot.configRoot()`. `config.ts` and `project-profile.ts` are refactored to
  import and re-export it (`const configRoot = ConfigRoot.configRoot`) instead of
  keeping their own copies; this is a pure extraction with no behavior change (locked by
  the existing 027/028/029/030 test suites staying green unmodified).
- **`tui.ts` precedence repositioning.** The `loadState` merge sequence changes from
  `base -> OPENCODE_TUI_CONFIG -> project files -> (.opencode dirs + profile, same tier)`
  to `base -> profile -> OPENCODE_TUI_CONFIG -> project files -> .opencode dirs`:
  - The profile becomes its own step, guarded on `ConfigRoot.configRoot() !==
    Global.Path.config` (so an unset override adds no second layer), merged via the
    same `mergeFile` helper as every other tier, exactly once.
  - The project `.opencode` discovery loop's filter drops the
    `|| dir === Flag.OPENCODE_CONFIG_DIR` clause (and the matching loop-body guard), so
    it only ever iterates real project `.opencode` directories.
  - `OPENCODE_TUI_CONFIG` keeps its relative position among the non-project-tree tiers
    (still loses to project files/`.opencode`, now also wins over the profile — its
    escape-hatch role is unchanged or strengthened, never weakened).
  - The directories returned for plugin-dependency `npm.install` (`data.dirs` in the
    outer `layer`) are widened back to include the profile directory when set, so
    plugins declared in the profile's `tui.json` still get their dependencies installed
    even though the profile no longer shares the project-discovery merge tier.
  - `tui-migrate.ts` is left untouched: it iterates `directories` per-directory
    independent of merge order, so the precedence fix does not affect it (confirmed by
    the existing migration test suite staying green).

Verification is a set of tests in `test/config/tui.test.ts` designed to fail under the
pre-031 (profile-in-highest-tier) order and pass after the fix: base-survives-under-
profile, project-overrides-profile (the direction the bug got wrong), default-unset
byte-for-byte, and profile-loads-exactly-once (no plugin-array duplication).

## Companion Artifacts

No companion files are needed for this correction. The change is a localized loader
refactor plus a DRY extraction, with test coverage; the CUE schema and Gherkin
`.feature` scaffolds are left as placeholders, matching features 024-030.
