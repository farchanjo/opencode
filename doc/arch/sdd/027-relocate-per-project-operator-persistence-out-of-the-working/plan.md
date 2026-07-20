# Implementation Plan: Relocate Per Project Operator Persistence Out Of The Working

## Overview

Today opencode writes the project-scoped operator config namespace into
`<projectDir>/config.json`, polluting every working directory and risking a
secret leak: that file carries provider/MCP API keys and lives in the source
tree (only gitignored as `/config.json`). This plan relocates that persistence
out of the working tree into the global profile store, keyed by the full project
path, and makes that per-project directory the canonical home for all
opencode-persisted project data. It realizes spec 027-relocate-per-project-
operator-persistence-out-of-the-working.

## Technical Approach

### New module — `packages/opencode/src/config/project-profile.ts`

A small module colocated with the config path resolution, holding:

- `encodeProjectPathKey(absPath): string` — a pure, unit-tested function that
  turns a resolved absolute path into a readable filename segment: normalize
  Windows separators to POSIX, drop the leading separator(s), replace each
  separator with `-`, then sanitize any character outside `[A-Za-z0-9._-]` to
  `-`. Example: `/Users/farchanjo/dev/cloudstack` →
  `Users-farchanjo-dev-cloudstack`.
- `projectProfileDir(dir): string` — resolves the input dir to a canonical
  absolute path (`Filesystem.resolve`, which normalizes and follows symlinks),
  then returns `<configRoot>/profiles/<key>`. This is the canonical directory
  future project-scoped persistence (operator config, memory files) reuses.
- `projectOperatorConfigPath(dir): string` — `<projectProfileDir>/config.json`.

The directory is anchored on the **operative config root** —
`Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config`, mirroring `Global.make()` in
`core/global.ts`. Anchoring on the raw `Global.Path.config` was wrong: that value
is the fixed XDG dir and never honors `OPENCODE_CONFIG_DIR`, so an isolated
profile (`~/.opencodedev`) would leak its per-project data back into
`~/.config/opencode`. Honoring the override is what lets the profile own its own
`profiles/<key>/` tree.

### Seam moves in `packages/opencode/src/config/config.ts`

- **Read seam** (`loadInstanceState`, inside the
  `!Flag.OPENCODE_DISABLE_PROJECT_CONFIG` gate): read the operator namespace from
  `ProjectProfile.projectOperatorConfigPath(ctx.directory)` instead of
  `path.join(ctx.directory, "config.json")`.
- **Write seam** (`Config.update`): write to
  `ProjectProfile.projectOperatorConfigPath(dir)` using `fs.writeWithDirs`, which
  creates the `profiles/<key>/` directory recursively before writing.

### Migration strategy — non-destructive read-through

In the read seam, when the relocated namespace is absent, fall back to reading
the legacy `<projectDir>/config.json` operator namespace (via the same
`loadOperatorNamespace`, which consumes only the `operator` key). When the legacy
namespace is used, emit one `Effect.logWarning` naming the legacy and relocated
paths, marking the in-tree file as a secret-leak vector to delete. The legacy
file is never auto-deleted (it may hold data opencode does not manage); the next
`Config.update` naturally persists to the relocated path.

### Env-flag handling

- `OPENCODE_CONFIG_DIR` — the profiles directory moves with the override because
  `projectProfileDir` anchors on `Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config`.
  Note (documented residual): the *global* `config.json` read/write in `config.ts`
  still anchors on the raw `Global.Path.config` and does NOT honor the override; a
  future feature can align that seam so an isolated profile also owns its global
  `config.json`. This feature only relocates the per-project (profile) data.
- `OPENCODE_DISABLE_PROJECT_CONFIG` — unchanged. The read seam lives inside the
  existing gate, so setting the flag skips the project namespace (relocated and
  legacy) entirely.

### Module choices

The encoding lives in a dedicated `config/project-profile.ts` module rather than
inline in `config.ts`, so the pure encoder is independently unit-testable and the
directory helper is importable by future features without pulling in the config
service. It matches the sibling-module idiom (`config/paths.ts`,
`config/managed.ts`).

## Test Plan

- **`test/config/project-profile.test.ts`** — pure unit tests for
  `encodeProjectPathKey`: the canonical example, leading-separator drop, collapse
  of repeated separators, preservation of allowed characters, sanitization of
  disallowed characters, hostile-segment bounding, Windows-separator handling,
  and the documented readable-collision trade-off.
- **`test/config/config.test.ts`** — integration tests over the real config
  service: (a) the project operator config persists under
  `<config>/profiles/<key>/config.json` and NOT in the working tree, and round-
  trips on load; (b) a legacy in-tree operator config is read through and then
  relocated on the next write with the legacy file left intact; (c)
  `OPENCODE_DISABLE_PROJECT_CONFIG` skips the relocated namespace. The pre-
  existing write/read tests are updated to assert the relocated path.

## Companion Artifacts

No companion artifacts (`research.md`, `data-model.md`, `contracts/`,
`quickstart.md`) are required; the change is a localized relocation with no new
data model or interface contract.
