---
id: 019f80c4-4eb0-7b02-92b6-75cec3ef0006
number: 030
slug: correct-feature-028-so-an-opencode-config-dir-profile-layers
status: analyzed
created_at: 2026-07-20T18:22:56.688517Z
---
# Feature Specification: Correct Feature 028 So An Opencode Config Dir Profile Layers

Feature: 030-correct-feature-028-so-an-opencode-config-dir-profile-layers
Created: 2026-07-20

## User Stories

- As a user who runs opencode with `OPENCODE_CONFIG_DIR` pointed at an isolated
  profile (e.g. `~/.opencodedev` holding only a minimal `config.json`), I want my
  REAL global config at `~/.config/opencode` (MCP servers, model, plugins) to KEEP
  loading, so setting the override does not silently break opencode by dropping my
  base configuration.
- As that same user, I want the isolated profile's global config to LAYER on top of
  the base as an override, so the profile can add or replace individual keys without
  having to re-declare my entire global config.
- As a user, I want the precedence to stay predictable — per-project profile config
  overrides the profile-global, which overrides the real global default
  (project > profile > global-real) — so relocating and layering the global seam does
  not change which value ultimately wins.
- As a user who has NOT set `OPENCODE_CONFIG_DIR`, I want global config resolution to
  be byte-for-byte identical to before, so this correction is invisible to the default
  path.
- As a security-conscious user, I want this change to touch config-file resolution
  ONLY and never relocate or expose auth material, so credentials are unaffected.

## Functional Requirements

1. **Layered global READ (base always loads).** The global config READ MUST always
   load the fixed XDG global dir `Global.Path.config` (`~/.config/opencode`) as the
   BASE. The base MUST NEVER be dropped. This corrects Feature 028, which anchored the
   global read solely on `configRoot()` and thereby stopped the real global config from
   loading whenever `OPENCODE_CONFIG_DIR` was set.
2. **Profile layers on top as an override.** When `Flag.OPENCODE_CONFIG_DIR` is set AND
   differs from `Global.Path.config`, the profile's global config (`config.json`,
   `opencode.json`, `opencode.jsonc` under `configRoot()`) MUST be deep-merged ON TOP of
   the base, so the profile only adds or overrides keys. Array handling (e.g.
   `instructions`) MUST use the same concat/dedupe semantics as the existing global↔local
   merge so base entries are preserved.
3. **Global config WRITE stays at `configRoot()`.** The write target
   (`globalConfigFile()` / `updateGlobal`) MUST remain anchored on `configRoot()` so the
   profile captures global-config changes without mutating the real global dir; when the
   override is unset the write lands in `Global.Path.config`. This keeps Feature 028's
   write behavior.
4. **Precedence.** Effective precedence MUST be project > profile > global-real: the
   per-project profile config (Feature 027 `profiles/<key>/`) overrides the profile-global
   layer, which overrides the real global default, on any overlapping key.
5. **Byte-for-byte default behavior.** When `OPENCODE_CONFIG_DIR` is unset,
   `configRoot() === Global.Path.config`, so there is NO separate profile layer and the
   base is the only global source; global config resolution MUST be identical to the
   pre-030 behavior.
6. **No double-load.** The profile's `opencode.json`/`opencode.jsonc` MUST be merged
   exactly once, at the profile-override precedence (below project). The base's
   `opencode.json`/`opencode.jsonc` MUST likewise be merged exactly once. Feature 028's
   `dir !== configRoot()` guard in the directories loop MUST be kept so neither the base
   dir (`Global.Path.config`) nor the config root re-loads those files; the rest of that
   loop's work (gitignore, dependency install, command/agent/plugin discovery) MUST still
   run for each directory.
7. **Credentials safety (invariant).** This change MUST touch only
   `config.json`/`opencode.json[c]` resolution. Auth material (`auth.json`, keychain) MUST
   NOT be relocated, read, written, or exposed. `auth.json` lives under `Global.Path.data`,
   out of the config root, and is untouched.
8. **Scope boundary.** `opencode.json`/`opencode.jsonc` project-tree discovery semantics,
   the Feature 027 per-project profile helper, and the `OPENCODE_DISABLE_PROJECT_CONFIG`
   gate MUST be unchanged. The TUI base config (`config/tui.ts`) still reads from the raw
   `Global.Path.config` and is OUT of scope here (tracked follow-up).

## Security Requirements

- **Data sensitivity/classification.** The global config file can carry provider and
  MCP configuration and the global-scoped operator namespace (potentially API-key-bearing)
  material. This feature changes only HOW that file is resolved for reads — it now layers
  two directories (base + profile) instead of replacing the base with the profile. It
  neither widens who can read the config nor changes its storage posture; if anything it
  restores the user's intended base config that Feature 028 had inadvertently dropped.
- **Authentication/authorization.** No new authenticated surface, credential, or
  permission boundary is introduced. Auth material is explicitly out of scope: `auth.json`
  resolves from `Global.Path.data` (xdgData), never from the config root, so no seam
  touched here reads or writes credentials. The operator CAS write authority and its
  single-committed-write contract are unchanged.
- **Input validation.** The untrusted input is the `OPENCODE_CONFIG_DIR` value, an
  established env flag consumed verbatim as a directory path (as in `Global.make()` and
  Feature 027). This feature adds no new parsing of it. Both the base and profile config
  files are parsed by the existing `ConfigParse` schema validation, which rejects unknown
  keys and malformed JSON. A missing base or profile file degrades to an empty config for
  that layer, never a crash.
- **Cryptography in transit/at rest.** Not applicable — this feature performs no
  transport and adds no at-rest encryption; it changes the resolution of local config
  files whose storage-at-rest posture is unchanged.
- **Logging/audit.** The feature logs only existing debug/info lines (the "loading" line
  with a file path, and the pre-existing `OPENCODE_CONFIG_DIR` debug line). It logs file
  paths, never file contents or secret values.
- **Error-handling information exposure.** A missing, unreadable, or malformed base or
  profile config degrades to defaults via the existing `Effect.orElseSucceed`/try-catch
  paths in the global loader; error paths surface file paths for actionability but never
  echo secret values or raw file bodies.

## Acceptance Scenarios

Given `OPENCODE_CONFIG_DIR` points at an isolated profile directory
And   the real global dir sets an MCP server the profile never declares
And   both the base and the profile set the same `model`
When  the instance config is loaded
Then  the base-only MCP server still resolves (the base survives)
And   the profile's `model` wins on the shared key

Given a base global authority, a profile-global override of that authority, and a
      per-project profile config that overrides it again
When  the instance config is loaded
Then  the per-project value wins (project > profile > global-real)
And   the base-only and profile-only authorities both still resolve

Given `OPENCODE_CONFIG_DIR` points at a directory whose `opencode.json` declares a
      plugin array
When  the instance config is loaded
Then  the effective config contains no duplicated plugin array entries

Given `OPENCODE_CONFIG_DIR` is unset
When  the instance config is loaded
Then  the global config resolves from `Global.Path.config` only, unchanged, with no
      separate profile layer

Given `OPENCODE_CONFIG_DIR` points at an isolated profile directory
When  the global config is updated
Then  the write lands in the override's global config file, not `~/.config/opencode`

Given `OPENCODE_CONFIG_DIR` points at an isolated profile directory
When  the config is loaded or the global config is written
Then  no `auth.json` is created or relocated under the override

## Observability

This feature introduces no new metrics or trace spans. It reuses the existing config
load/update spans and debug/info logs (the "loading" file-path line and the pre-existing
`OPENCODE_CONFIG_DIR` debug line). Log records carry file paths only, never config or
secret contents. Conventions live in `doc/arch/observability/observability.md`.

## Clarifications
</content>
</invoke>
