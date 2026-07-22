---
status: superseded
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0028 — Make The Global Opencode Config Honor The Opencode Config

## Context and Problem Statement

Feature 027 relocated the per-project operator config into
`<configRoot>/profiles/<key>/config.json`, where `configRoot =
Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config` (see
`packages/opencode/src/config/project-profile.ts`). That closed the per-project
secret-leak vector and let an isolated profile (e.g. `OPENCODE_CONFIG_DIR=~/.opencodedev`)
own its own `profiles/` tree. But it left a documented residual: the GLOBAL config
in `packages/opencode/src/config/config.ts` still anchors every seam on the RAW
`Global.Path.config` — the fixed XDG dir (`~/.config/opencode`) that never reads the
override. An isolated profile therefore owns its per-project `profiles/` tree while
its global `config.json` / `opencode.json[c]` still resolve to `~/.config/opencode`.
The override is honored inconsistently: half the config surface relocates, half does
not.

The question: how to align the global config seams with the same operative config
root so `OPENCODE_CONFIG_DIR` isolates the WHOLE config surface — without changing
default (override-unset) behavior, without altering the project-over-global
precedence model, without duplicating array entries from a double file load, and
without touching auth material.

## Decision Drivers

- **Consistent isolation.** An explicit `OPENCODE_CONFIG_DIR` must own the global
  config too, not just the per-project profile store, so an isolated profile is
  genuinely self-contained.
- **Zero default drift.** With the override unset, global config resolution must be
  byte-for-byte identical to the pre-028 behavior.
- **Preserve precedence.** The per-project profile config must keep overriding the
  global config where they overlap; the global config stays the fallback default.
- **No double-load bug.** Loading the same `opencode.json`/`opencode.jsonc` twice
  (global loader + directories loop) must not duplicate array entries or re-run the
  merge on identical content.
- **Credentials untouched.** The change must confine itself to config-file
  resolution and never relocate, read, write, or expose auth material.

## Considered Options

- **Option A — One `configRoot()` resolver, applied at every global seam, plus a
  double-load guard (chosen).** Add `configRoot() = Flag.OPENCODE_CONFIG_DIR ??
  Global.Path.config` in `config.ts` (mirroring `Global.make()` and Feature 027) and
  replace the raw `Global.Path.config` at each global seam with it. Skip the
  directories-loop file-load for the config root, since the global loader now covers
  it.
- **Option B — Read `Global.make().config` instead of a local resolver.** Rejected:
  it couples `config.ts` to the `Global` service construction path and reads less
  clearly at each seam; a one-line local helper mirroring the established Feature 027
  pattern is simpler and keeps the seams self-documenting.
- **Option C — Keep the global loader on raw XDG and let the directories loop handle
  the override's `opencode.json`.** Rejected: it leaves the global `config.json`
  (which the loop never loads) stranded on `~/.config/opencode`, so the override is
  still only half-honored — the exact residual this feature closes.
- **Option D — Relocate auth alongside the config.** Rejected and explicitly out of
  scope: auth material is credential-sensitive and lives under `Global.Path.data`;
  moving it is a separate, higher-risk decision with its own threat model. This
  feature guarantees auth is untouched.

## Decision Outcome

Chosen option: **Option A**, because it honors `OPENCODE_CONFIG_DIR` consistently
across the whole config surface with a single resolver, keeps default behavior
byte-for-byte unchanged, preserves the project-over-global precedence model, and
prevents the double-load — all while leaving auth material untouched.

Key decisions recorded:

1. **Single operative resolver (FR1).** `configRoot()` returns
   `Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config`, the single source of the GLOBAL
   config-file location, mirroring `Global.make()` and the Feature 027 profile store.
2. **Seam moves (FR2).** Every global config seam moves onto `configRoot()`:
   `globalConfigFile()` candidate resolution (so the WRITE target honors the
   override); the `loadGlobal()` reads of `config.json`, `opencode.json`, and
   `opencode.jsonc`; the legacy `config` (TOML) dir read and its `config.json`
   rewrite; and the global merge source (keeping plugin-origin provenance accurate).
3. **Zero default drift (FR3).** When the override is unset, `configRoot() ===
   Global.Path.config`, so global config resolution is unchanged.
4. **Precedence preserved relative to project config (FR4, the user's explicit
   rule).** Relative to project sources, precedence is unchanged in the sense that
   matters: project always wins. Concretely: the global config (now read via
   `configRoot()`) still merges first, then project-tree `opencode.json[c]` files and
   the per-project operator namespace layer on top and win on overlapping keys. What
   DOES shift is WHICH loader reads the override's `opencode.json`/`opencode.jsonc`:
   pre-028, the directories loop loaded them AFTER project files (via the
   `Flag.OPENCODE_CONFIG_DIR` directory), so they would have won on an overlapping
   key — global-over-project, the wrong direction. Post-028, `loadGlobal()` reads them
   as part of the global merge, BEFORE project files, so project now correctly wins.
   This is a precedence CORRECTION, not a no-op: it fixes an inversion that existed
   whenever `OPENCODE_CONFIG_DIR` was set and its `opencode.json[c]` overlapped a
   project key. A test proves a shared operator authority set in the profile config
   wins over the global config while a global-only authority still applies, and a
   second test proves a project-tree `opencode.json` wins over an
   `OPENCODE_CONFIG_DIR`-rooted `opencode.json` on an overlapping key.
5. **Double-load guard, a performance fix (FR5).** The directories loop already loads
   `opencode.json`/`opencode.jsonc` from `OPENCODE_CONFIG_DIR`. Once the global loader
   also loads those two from `configRoot()`, the same files would load twice. This is
   NOT a correctness fix for array duplication: duplication is already prevented
   independently of this guard — `merge()` overwrites `plugin` via
   `ConfigPlugin.deduplicatePluginOrigins` (dedupe by plugin identity), `instructions`
   concatenates through a `Set`, and remeda's `mergeDeep` replaces every other array
   wholesale rather than concatenating it. What the double load would actually cost is
   redundant WORK: re-reading the file from disk, re-running `ConfigVariable`
   substitution, re-resolving plugin origins, and (for the legacy TOML path) a second
   `$schema` write-back — all for content already merged once. The fix guards the
   directories-loop file-load with `dir !== configRoot()`, so the config root is
   loaded exactly once (by the global loader); the rest of the loop body (gitignore,
   dependency install, command/agent/plugin discovery) still runs for that directory.
   A test proves the effective config has no duplicated plugin array entries — locking
   the outcome, which the independent dedup/merge logic already guarantees regardless
   of this guard.
6. **Credentials-safety finding (FR6, invariant).** Auth material is untouched. The
   auth store resolves from `Global.Path.data` (xdgData) in `src/auth/index.ts`
   (`path.join(Global.Path.data, "auth.json")`), out of the config root; it never
   reads `OPENCODE_CONFIG_DIR` and is not under `Global.Path.config`. Every seam moved
   here concerns `config.json` / `opencode.json[c]` resolution only — none reads or
   writes auth. A test confirms no `auth.json` is created or relocated under the
   override.
7. **Scope boundary (FR7).** `opencode.json`/`opencode.jsonc` project-tree discovery,
   the Feature 027 per-project profile helper, and the `OPENCODE_DISABLE_PROJECT_CONFIG`
   gate are unchanged.

### Consequences

- Good: `OPENCODE_CONFIG_DIR` now isolates the WHOLE config surface — an isolated
  profile owns its global `config.json` / `opencode.json[c]` as well as its per-project
  `profiles/` tree, closing the residual documented in ADR-0027.
- Good: default behavior is byte-for-byte unchanged (`configRoot() ===
  Global.Path.config` when the override is unset), so existing users see no change.
- Good: the project-over-global precedence model is preserved and test-locked; a
  latent inversion (see FR4) is also corrected, not merely preserved.
- Good: the opencode.json/opencode.jsonc double-load is eliminated, avoiding
  redundant re-read, variable substitution, plugin re-resolution, and (for the legacy
  TOML path) a redundant `$schema` write-back on identical content; array duplication
  was already independently prevented by the merge/dedupe logic (see FR5).
- Good: auth material is provably untouched — credentials stay under
  `Global.Path.data` and are never relocated or exposed.
- Changed (corrected precedence): the override's `opencode.json`/`opencode.jsonc` now
  load via the global loader (global scope, merged BEFORE project files) instead of
  late in the directories loop (merged AFTER project files). Relative to project
  `opencode.json[c]` files this is a real shift — project files now win on overlapping
  keys, which is the correct project-over-global direction; pre-028 the override would
  have won instead. Relative to other global sources, ordering is unchanged.
- Out of scope (tracked residual): the global TUI config (`packages/opencode/src/config/tui.ts`)
  still reads its base file from the raw `Global.Path.config` and does not honor
  `OPENCODE_CONFIG_DIR` (it has its own, separate `OPENCODE_TUI_CONFIG` override flag).
  This is a consistency gap left for a later feature, not addressed here.

## Related

- Feature specification: [028 Make the global opencode config honor the opencode config](../sdd/028-make-the-global-opencode-config-honor-the-opencode-config/spec.md)
- The per-project relocation that introduced the `configRoot` pattern and documented this residual: [027 Relocate per-project operator persistence out of the working tree](../sdd/027-relocate-per-project-operator-persistence-out-of-the-working/spec.md)
- The operator namespace write/read seam whose global-scoped authorities travel through the global config file: [Feature 014 Wire the config-backed operator persistence and service](../sdd/014-complete-the-operator-control-plane-persistence-and-service/spec.md)

## Links

- Status: **superseded** by ADR-0030 (layered global READ supersedes 028's replace model).
- READ path: superseded by ADR-0030. WRITE/`configRoot` pattern remains cited by later ADRs (ADR-0031, ADR-0032).
- Related: ADR-0027 (configRoot / profiles origin), ADR-0031 (TUI residual), ADR-0030 (successor).
