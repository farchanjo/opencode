---
id: 019f8087-0533-73a2-8f4c-ae00adf22b20
number: 028
slug: make-the-global-opencode-config-honor-the-opencode-config
status: implemented
created_at: 2026-07-20T17:16:00.179905Z
---
# Feature Specification: Make The Global Opencode Config Honor The Opencode Config

Feature: 028-make-the-global-opencode-config-honor-the-opencode-config
Created: 2026-07-20

## User Stories

- As a user running an isolated opencode profile (e.g. `OPENCODE_CONFIG_DIR=~/.opencodedev`),
  I want my GLOBAL `config.json` / `opencode.json[c]` to resolve under that override,
  so the isolated profile fully owns its configuration instead of silently reading
  and writing the fixed XDG `~/.config/opencode`.
- As a user, I want the per-project profile config to keep overriding the global
  config where the two overlap, and the global config to stay the fallback default
  otherwise, so relocating the global seam does not change which value wins.
- As a maintainer, I want a single operative config-root resolver used at every
  global-config seam, so the override is honored consistently and no seam drifts
  back to the raw XDG path.
- As a security-conscious user, I want this change to touch config-file resolution
  ONLY and never relocate or expose auth material, so credentials are unaffected.

## Functional Requirements

1. **Single operative config-root resolver.** A `configRoot()` helper MUST return
   `Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config`, mirroring `Global.make()` and the
   Feature 027 per-project profile store. It is the single source for the GLOBAL
   config-file location.
2. **Move every global config seam.** The global config seams in `config.ts` that
   read the raw `Global.Path.config` MUST anchor on `configRoot()`: `globalConfigFile()`
   candidate resolution; the `loadGlobal()` reads of `config.json`, `opencode.json`,
   and `opencode.jsonc`; the legacy `config` (TOML) directory read and its
   `config.json` rewrite; and the global merge source. The global config WRITE
   (`updateGlobal` via `globalConfigFile()`) MUST therefore also honor the override.
3. **Byte-for-byte default behavior.** When `OPENCODE_CONFIG_DIR` is unset,
   `configRoot() === Global.Path.config`, so global config resolution MUST be
   unchanged from the pre-028 behavior.
4. **Preserve project-over-global precedence.** The per-project profile config MUST
   continue to OVERRIDE the global config where a key is present in both; the global
   config MUST remain the fallback default otherwise. The merge order (global merged
   first, the per-project operator namespace layered on top) MUST still yield
   project-over-global after the seam move.
5. **Prevent the opencode.json/opencode.jsonc double-load.** Once the global loader
   reads `opencode.json`/`opencode.jsonc` from `configRoot()` (= `OPENCODE_CONFIG_DIR`
   when set), the directories loop — which also loads those two files from
   `OPENCODE_CONFIG_DIR` — MUST NOT load them a second time for that directory. The
   effective config MUST contain no duplicated array entries as a result of the
   relocation. The rest of the directories-loop work (gitignore, dependency install,
   command/agent/plugin discovery) for the config root MUST still run.
6. **Credentials safety (invariant).** This change MUST touch only
   `config.json`/`opencode.json[c]` resolution. Auth material (`auth.json`, keychain)
   MUST NOT be relocated, read, written, or exposed. `auth.json` lives under
   `Global.Path.data`, out of the config root, and is untouched.
7. **Scope boundary.** `opencode.json`/`opencode.jsonc` project-tree discovery
   semantics, the Feature 027 per-project profile helper, and the
   `OPENCODE_DISABLE_PROJECT_CONFIG` gate MUST be unchanged.

## Security Requirements

- **Data sensitivity/classification.** The global config file can carry provider
  and MCP configuration and the global-scoped operator namespace (potentially
  API-key-bearing) material. This feature only changes WHERE that file is resolved
  (the operative config root); it neither widens who can read it nor changes its
  storage posture. Confining it under an explicit `OPENCODE_CONFIG_DIR` is a
  containment improvement for isolated profiles.
- **Authentication/authorization.** No new authenticated surface, credential, or
  permission boundary is introduced. Auth material is explicitly out of scope:
  `auth.json` resolves from `Global.Path.data` (xdgData), never from the config
  root, so no seam moved here reads or writes credentials. The operator CAS write
  authority and its single-committed-write contract are unchanged.
- **Input validation.** The untrusted input is the `OPENCODE_CONFIG_DIR` value,
  already an established env flag consumed verbatim as a directory path (as it is
  in `Global.make()` and Feature 027). This feature adds no new parsing of it; the
  config files it points at are parsed by the existing `ConfigParse` schema
  validation, which rejects unknown keys and malformed JSON. A missing global file
  degrades to an empty config, never a crash.
- **Cryptography in transit/at rest.** Not applicable — this feature performs no
  transport and adds no at-rest encryption; it relocates the resolution of a local
  config file whose storage-at-rest posture is unchanged.
- **Logging/audit.** The feature logs only existing debug lines (e.g. "loading"
  with a file path, and the pre-existing `OPENCODE_CONFIG_DIR` debug line). It logs
  file paths, never file contents or secret values.
- **Error-handling information exposure.** A missing, unreadable, or malformed
  global config degrades to defaults via the existing `Effect.orElseSucceed`/
  try-catch paths in the global loader; error paths surface file paths for
  actionability but never echo secret values or raw file bodies.

## Acceptance Scenarios

Given `OPENCODE_CONFIG_DIR` points at an isolated profile directory
And   a `config.json` under that directory sets a model
When  the instance config is loaded
Then  the effective model resolves from the override's `config.json`

Given `OPENCODE_CONFIG_DIR` points at an isolated profile directory
When  the global config is updated
Then  the write lands in the override's global config file, not `~/.config/opencode`

Given a global config and a per-project profile config that both set the same
      operator authority, and the global config also sets a second authority
When  the instance config is loaded
Then  the profile config's authority wins for the shared key
And   the global-only authority still applies as the fallback default

Given `OPENCODE_CONFIG_DIR` points at a directory whose `opencode.json` declares a
      plugin array
When  the instance config is loaded
Then  the effective config contains no duplicated plugin array entries

Given `OPENCODE_CONFIG_DIR` is unset
When  the instance config is loaded
Then  the global config resolves from `Global.Path.config`, unchanged

Given `OPENCODE_CONFIG_DIR` points at an isolated profile directory
When  the config is loaded or the global config is written
Then  no `auth.json` is created or relocated under the override

## Observability

This feature introduces no new metrics or trace spans. It reuses the existing
config load/update spans and debug logs (the "loading" file-path line and the
pre-existing `OPENCODE_CONFIG_DIR` debug line). Log records carry file paths only,
never config or secret contents. Conventions live in
`doc/arch/observability/observability.md`.

## Clarifications
