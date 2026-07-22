---
id: 019f8065-e5c1-7481-a071-b4cab3cc7901
number: 027
slug: relocate-per-project-operator-persistence-out-of-the-working
status: implemented
created_at: 2026-07-20T16:39:49.441814Z
---
# Feature Specification: Relocate Per Project Operator Persistence Out Of The Working

Feature: 027-relocate-per-project-operator-persistence-out-of-the-working
Created: 2026-07-20

## User Stories

- As a user, I want opencode's per-project operator config to persist outside my
  working directory, so my source tree is never polluted with an opencode
  `config.json` and provider/MCP API keys never risk leaking into a repository.
- As a user with existing projects, I want my already-persisted project operator
  config to keep working after the relocation without any manual migration step,
  so an upgrade is transparent.
- As a maintainer, I want a single canonical, path-keyed profile directory for
  all opencode-persisted project data (operator config, memory files, future
  project-scoped persistence), so new features reuse one location instead of
  scattering state across working trees.

## Functional Requirements

1. **Relocate project persistence.** The project-scoped operator config namespace
   MUST persist to `<configRoot>/profiles/<ENCODED_ABSPATH>/config.json` instead of
   `<projectDir>/config.json`, where `<configRoot>` is the operative config root
   `Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config`. When `OPENCODE_CONFIG_DIR` is
   set (e.g. an isolated profile such as `~/.opencodedev`), the profile store MUST
   live under that override, NOT under the fixed XDG `~/.config/opencode`.
2. **Readable, reversible-ish path key.** The encoding MUST resolve the project
   directory to a canonical absolute path, drop the leading separator, replace
   each path separator with `-`, and sanitize any character outside
   `[A-Za-z0-9._-]` to `-`. Example: `/Users/farchanjo/dev/cloudstack` →
   `Users-farchanjo-dev-cloudstack`. The listing MUST be human-readable
   (`ls profiles/`), NOT an opaque hash.
3. **Canonical profile directory helper.** A `projectProfileDir(dir)` helper MUST
   expose the per-project directory so future project-scoped persistence reuses
   it, and `projectOperatorConfigPath(dir)` MUST expose the relocated config file.
4. **Read seam.** The instance loader MUST read the project operator namespace
   from the relocated path.
5. **Write seam.** `Config.update` MUST write to the relocated path and MUST
   create the `profiles/<key>/` directory recursively before writing.
6. **Non-destructive migration read-through.** When the relocated namespace is
   absent but a legacy `<projectDir>/config.json` operator namespace exists, the
   loader MUST read the legacy namespace so existing projects keep working, and
   the next write MUST persist to the relocated path. The loader MUST emit a
   warning that surfaces the stray in-tree file as a secret-leak vector to delete,
   and MUST NOT auto-delete the legacy file.
7. **Env-flag handling.** The profiles directory MUST move with
   `OPENCODE_CONFIG_DIR` (anchored on `Flag.OPENCODE_CONFIG_DIR ??
   Global.Path.config`). The `OPENCODE_DISABLE_PROJECT_CONFIG` gate behavior MUST be
   unchanged: when set, the project namespace (including the relocated one) is
   skipped entirely. (Residual, out of scope: the *global* `config.json` seam still
   anchors on the raw `Global.Path.config` and does not relocate under the override.)
8. **Scope boundary.** `opencode.json`/`opencode.jsonc` project-tree discovery,
   global-scoped operator authorities, and user-authored source-controlled config
   MUST be untouched. Only opencode-persisted project data relocates.

## Security Requirements

- **Data sensitivity/classification.** The relocated file carries the project
  operator namespace, which can hold provider and MCP API keys — high-sensitivity
  secret material. Moving it out of the working tree removes the primary risk that
  those keys are accidentally committed to a repository; the file already lives in
  the user's private global config profile, which is not source-controlled.
- **Authentication/authorization.** No new authenticated surface, credential, or
  permission boundary is introduced. The relocation only changes the on-disk
  location of already-persisted data; the operator CAS write authority and its
  single-committed-write contract are unchanged.
- **Input validation.** The untrusted input is the project directory path, which
  becomes a filesystem path segment. It is resolved to a canonical absolute path,
  then encoded by dropping the leading separator, replacing separators, and
  sanitizing every character outside `[A-Za-z0-9._-]` to `-`. This bounds hostile
  or exotic path segments to a single, flat filename that cannot traverse out of
  the profiles directory (no `/`, NUL, or drive colon survives; `..` dots survive
  as literal, harmless filename characters because no separator remains). The
  file's `operator` key alone is consumed and validated against the config schema;
  a malformed or absent namespace degrades to no namespace, never a crash.
- **Cryptography in transit/at rest.** Not applicable — this feature performs no
  transport and adds no at-rest encryption; it relocates a local file whose
  storage-at-rest posture is unchanged. The security gain is confinement to the
  private profile store rather than the working tree.
- **Logging/audit.** The migration path logs one warning that names the legacy
  and relocated file paths so the user can delete the stray in-tree file. It logs
  paths only — never the file contents, the operator namespace, or any secret
  material.
- **Error-handling information exposure.** A missing, unreadable, or malformed
  legacy or relocated file degrades to "no operator namespace" via the existing
  try/catch in the namespace loader; error paths surface file paths for
  actionability but never echo secret values or raw file bodies.

## Acceptance Scenarios

Given a project directory with no persisted operator config
When  the operator commits a project-scoped config mutation
Then  the config is written to `<config>/profiles/<encoded-path>/config.json`
And   no `config.json` is written into the project working tree

Given a project operator config persisted to the profile store
When  the instance config is loaded
Then  the relocated operator namespace is read back into the effective config

Given an existing project with a legacy in-tree `config.json` operator namespace
When  the instance config is loaded with the profile store still empty
Then  the legacy namespace is read through so the project keeps working
And   a warning surfaces the stray in-tree file as a secret-leak vector
And   the next write persists to the profile store, leaving the legacy file intact

Given `OPENCODE_DISABLE_PROJECT_CONFIG` is set
When  the instance config is loaded
Then  the relocated project operator namespace is skipped entirely

## Observability

The migration read-through emits one `Effect.logWarning` at the application
boundary, carrying the legacy and relocated file paths (never secret contents) so
an operator can locate and delete the stray in-tree file. No new metrics or trace
spans are introduced; the relocation reuses the existing config load/update spans.
Conventions live in `doc/arch/observability/observability.md`.

## Clarifications
