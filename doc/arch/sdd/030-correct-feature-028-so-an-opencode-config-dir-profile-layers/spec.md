---
id: 019f80c4-4eb0-7b02-92b6-75cec3ef0006
number: 030
slug: correct-feature-028-so-an-opencode-config-dir-profile-layers
status: implemented
created_at: 2026-07-20T18:22:56.688517Z
---
# Feature Specification: Correct Feature 028 So An Opencode Config Dir Profile Layers

Feature: 030-correct-feature-028-so-an-opencode-config-dir-profile-layers
Created: 2026-07-20

**Corrects** [Feature 028](../028-make-the-global-opencode-config-honor-the-opencode-config/spec.md)
(`configRoot()` global seam relocation). 028 remains SSOT for the single
operative config-root resolver, write-target anchoring on `configRoot()`,
double-load guard, credentials-safety invariant, and project-over-global
precedence when no profile override is set. This feature only adds **layered
global READ**: base `Global.Path.config` always loads; an `OPENCODE_CONFIG_DIR`
profile deep-merges on top. Do not restate 028 scenarios here — reuse them for
the unset-override and write-target paths; acceptance scenarios below cover the
layering correction only.

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
  (project > profile > global-real) — so layering the global seam does not invert winners.
- Unset-override default path and credentials-safety stories stay under Feature 028;
  this correction must not regress them.

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
3. **Global config WRITE stays at `configRoot()`.** Keep Feature 028 write anchoring;
   layering changes READ only. Profile captures global-config mutations without mutating
   the real global dir.
4. **Precedence.** Effective precedence MUST be project > profile > global-real: the
   per-project profile config (Feature 027 `profiles/<key>/`) overrides the profile-global
   layer, which overrides the real global default, on any overlapping key.
5. **Default path + double-load + credentials + scope.** When the override is unset,
   resolution MUST match pre-030 (no separate profile layer). Profile and base
   `opencode.json[c]` each merge once; keep Feature 028's `dir !== configRoot()` guard.
   Credentials safety and scope boundary remain exactly as Feature 028 states them. The
   TUI base config (`config/tui.ts`) still reads raw `Global.Path.config` (out of scope).

## Security Requirements

Inherits Feature 028 Security Requirements (credentials safety, no new auth surface,
schema validation, path-only logging). **Layering-only delta:** reads now resolve two
directories (base `Global.Path.config` + profile `configRoot()`) instead of replacing
the base; neither layer widens who can read config nor relocates `auth.json`. A missing
base or profile file degrades to an empty layer, never a crash.

## Acceptance Scenarios

Layering correction only. Unset-override resolution, write-target anchoring on
`configRoot()`, double-load guard for `opencode.json[c]`, and credentials-safety
acceptance remain under [Feature 028](../028-make-the-global-opencode-config-honor-the-opencode-config/spec.md)
and are not re-listed here.

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

## Observability

No new metrics or spans. Reuses Feature 028 config load/update logging (path-only);
conventions in `doc/arch/observability/observability.md`.

## Clarifications
