---
id: 019f80ef-83ae-7fc1-8e50-5af68cbbc754
number: 031
slug: correct-the-operator-global-tui-config-precedence-so
status: implemented
created_at: 2026-07-20T19:10:08.302977Z
---
# Feature Specification: Correct The Operator Global Tui Config Precedence So

Feature: 031-correct-the-operator-global-tui-config-precedence-so
Created: 2026-07-20

## User Stories

- As a user who runs the TUI with `OPENCODE_CONFIG_DIR` pointed at an isolated profile,
  I want a project's `.opencode/tui.json` to WIN over my profile's tui config, so that
  per-project tui settings (theme, keybinds, plugins) are never silently shadowed by an
  unrelated profile.
- As that same user, I want my profile's tui config to still OVERRIDE the base
  `~/.config/opencode` tui config on any shared key, so the profile remains a useful
  override layer for settings I have not customized per project.
- As a user, I want the precedence to match the server config's corrected model
  (project > profile > global-real, established by Feature 030), so the TUI and the
  server never disagree about which config file wins.
- As a user who has NOT set `OPENCODE_CONFIG_DIR`, I want tui config resolution to be
  byte-for-byte identical to before, so this correction is invisible to the default path.
- As a user relying on `OPENCODE_TUI_CONFIG` as an explicit escape hatch, I want it to
  keep winning over the base and the profile exactly as before, so this correction does
  not regress that override.
- As a maintainer, I want the duplicated `configRoot()` resolver (`config.ts` and
  `project-profile.ts`) consolidated into one shared module reused by `tui.ts`, so the
  profile-directory definition cannot drift between the server, project-profile, and tui
  config seams.

## Functional Requirements

1. **Profile is a MIDDLE layer, not the highest tier.** The tui config loader
   (`packages/opencode/src/config/tui.ts`) MUST merge the `OPENCODE_CONFIG_DIR` profile's
   `tui.json`/`tui.jsonc` as its own layer, positioned ABOVE the base
   `Global.Path.config` tui config and BELOW project `.opencode` tui config discovery.
   This corrects the bug where the profile was merged inside the same highest-precedence
   tier as project `.opencode` directories and, because it was iterated last, wrongly won
   over a project `.opencode` tui config.
2. **Project `.opencode` discovery no longer includes the profile.** The
   `.opencode`-directory discovery loop MUST filter to real project `.opencode`
   directories only (`dir.endsWith(".opencode")`); the `|| dir === Flag.OPENCODE_CONFIG_DIR`
   clause and any matching loop-body condition MUST be removed so that tier no longer
   double-serves as the profile's merge slot.
3. **Effective precedence.** On any overlapping key, effective precedence (lowest to
   highest) MUST be: base `Global.Path.config` tui config < `OPENCODE_CONFIG_DIR` profile
   tui config < `OPENCODE_TUI_CONFIG` explicit override < project tui files (root-first
   `tui.json`/`tui.jsonc` discovery) < project `.opencode` directory tui config.
4. **`OPENCODE_TUI_CONFIG` escape hatch preserved.** The explicit `OPENCODE_TUI_CONFIG`
   file override MUST keep winning over both the base and the profile layer, and MUST
   keep losing to project tui files and project `.opencode` directories — unchanged from
   pre-031 behavior. This is a regression guard, not a precedence change.
5. **No double-load.** The profile's `tui.json`/`tui.jsonc` MUST be merged exactly once.
   Removing it from the `.opencode` discovery loop and adding it as a dedicated layer
   MUST NOT result in it being read or merged twice (which would duplicate array fields
   such as `plugin`).
6. **Byte-for-byte default behavior.** When `OPENCODE_CONFIG_DIR` is unset (or equals
   `Global.Path.config`), there MUST be no separate profile layer; tui config resolution
   MUST be identical to the pre-031 behavior (base + project only).
7. **Shared `configRoot()` resolver (DRY).** The `configRoot() = Flag.OPENCODE_CONFIG_DIR
   ?? Global.Path.config` resolver, previously duplicated between `config.ts` and
   `project-profile.ts`, MUST be extracted into one shared module
   (`packages/opencode/src/config/config-root.ts`) exporting `configRoot(): string`.
   `config.ts`, `project-profile.ts`, and `tui.ts` MUST all import and use this one
   implementation; no seam may keep or reintroduce its own copy. Extraction MUST NOT
   change behavior for `config.ts` or `project-profile.ts` (Feature 027/028/029/030
   tests keep passing unmodified).
8. **Plugin dependency install targets preserved.** Plugins declared in the profile's
   `tui.json` MUST still have their dependencies installed (the profile directory stays
   in the set of directories returned for `npm.install`), even though the profile no
   longer shares the project-discovery merge tier.
9. **Migration unaffected.** `tui-migrate.ts` iterates `directories` (which still
   includes `OPENCODE_CONFIG_DIR`) per-directory, independent of merge order; this
   feature's precedence change MUST NOT alter migration behavior. This is a scope
   confirmation, not a code change.
10. **Scope boundary.** No change to tui rendering, the tui config schema, or the tui
    config file discovery for the base and project tiers beyond the profile-layer
    repositioning described above. No auth/credential relocation.

## Security Requirements

- **Data sensitivity/classification.** The tui config can carry a `plugin` array
  (arbitrary plugin specs/paths) and keybind/theme preferences — no credentials. This
  feature changes only WHICH layer wins when the same key is set in more than one tui
  config file; it does not widen what is read, who can read it, or where it is stored.
- **Authentication/authorization.** Not applicable — this feature introduces no new
  authenticated surface, credential, or permission boundary. It touches tui config-file
  merge order only.
- **Input validation.** The untrusted input is the `OPENCODE_CONFIG_DIR` env value
  (an established flag, consumed verbatim as a directory path, unchanged by this
  feature) and the tui config files themselves, which are still parsed and validated by
  the existing `ConfigParse.schema(Info, ...)` path with the existing malformed-JSON and
  unreadable-file degrade-to-`{}` handling (`loadFile`/`load` in `tui.ts`). This feature
  adds no new parsing.
- **Cryptography in transit/at rest.** Not applicable — no transport, no new at-rest
  storage; this changes only the in-process merge order of local config files whose
  storage posture is unchanged.
- **Logging/audit.** The feature reuses the existing `Effect.logInfo`/`Effect.logDebug`
  lines ("loading tui config", "applying tui config", the `OPENCODE_TUI_CONFIG` debug
  line) which log file paths and merge order only, never file contents or secret values.
  No new log statements are added beyond what already exists for each layer.
- **Error-handling information exposure.** A missing, unreadable, or malformed profile
  tui config degrades to `{}` via the existing `mergeFile`/`loadFile`/`load` error
  handling (`Effect.catchCause` → `Effect.logWarning` with a file path and formatted
  reason, never raw file contents or secret values) — unchanged from the base and
  project tiers' existing behavior.

## Acceptance Scenarios

Given a base tui config at `Global.Path.config` sets `diff_style`
And   an `OPENCODE_CONFIG_DIR` profile tui config sets `theme`
When  the tui config is loaded
Then  the profile's `theme` applies
And   the base's `diff_style` still applies (the base is never dropped)

Given an `OPENCODE_CONFIG_DIR` profile tui config sets `theme` and `diff_style`
And   a project `.opencode/tui.json` sets `theme` only
When  the tui config is loaded
Then  the project's `theme` wins over the profile's `theme` (project > profile)
And   the profile's `diff_style` still applies underneath the project layer

Given `OPENCODE_CONFIG_DIR` is unset
And   a base tui config and a project `.opencode/tui.json` set the same key
When  the tui config is loaded
Then  the project value wins, identical to pre-031 behavior, with no profile layer

Given an `OPENCODE_CONFIG_DIR` profile tui config declares a `plugin` array
When  the tui config is loaded
Then  the effective `plugin` array contains no duplicated entries
And   the plugin's dependencies are still installed from the profile directory

Given both an `OPENCODE_TUI_CONFIG` file override and an `OPENCODE_CONFIG_DIR` profile
      tui config set the same key
When  the tui config is loaded
Then  the `OPENCODE_TUI_CONFIG` value wins (the explicit escape hatch is preserved)

## Observability

This feature introduces no new metrics or trace spans. It reuses the existing tui
config load spans and `Effect.logInfo`/`Effect.logDebug`/`Effect.logWarning` lines
("loading tui config", "applying tui config", "loaded custom tui config", "skipping
invalid tui config") which log file paths and merge order only, never tui config
contents. Conventions live in `doc/arch/observability/observability.md`.

## Clarifications
