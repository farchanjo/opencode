---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0027 — Relocate Per-Project Operator Persistence Out Of The Working Tree

## Context and Problem Statement

opencode persists the project-scoped operator config namespace to
`<projectDir>/config.json` (Feature 014: `Config.update` writes it; the instance
loader reads it back via `loadOperatorNamespace`, consuming only the `operator`
key). That file carries provider and MCP API keys, yet it is written into the
working directory of every project the operator touches. It is only gitignored as
`/config.json`, so it pollutes each source tree and is a live secret-leak vector:
one careless `git add -f`, a nested checkout, or a tool that ignores gitignore can
commit provider credentials into a repository.

The question: how to move this persistence out of the working tree — into the
user's private global profile — while keeping existing projects working, without
touching source-controlled config discovery (`opencode.json`/`opencode.jsonc`) or
the global-scoped operator authorities, and without breaking the operator CAS
write/read alignment.

## Decision Drivers

- **Close the secret-leak vector.** Project operator data (API keys) must not live
  in the working tree.
- **Readable on disk.** The per-project location must be human-inspectable
  (`ls profiles/`), not an opaque hash, so a user can find and audit their state.
- **Transparent upgrade.** Existing projects with a legacy in-tree `config.json`
  must keep working with no manual migration step.
- **Non-destructive.** opencode must never delete a user's in-tree file; it may
  hold data opencode does not manage.
- **One canonical home.** The per-project directory must be reusable for all
  future opencode-persisted project data (operator config, memory files), not a
  one-off for the operator namespace.
- **Zero contract surface.** No change to the operator command catalog, the CAS
  write authority, config discovery, or the `OPENCODE_DISABLE_PROJECT_CONFIG` gate.

## Considered Options

- **Option A — Relocate to a path-keyed profile directory with a readable
  encoding and a non-destructive migration read-through (chosen).** Persistence
  moves to `<Global.Path.config>/profiles/<ENCODED_ABSPATH>/config.json`, keyed by
  the resolved absolute project path with a readable, reversible-ish encoding. The
  loader reads the relocated path, falls back to the legacy in-tree file when the
  new location is absent (logging a secret-leak warning), and the next write
  persists to the new location. A `projectProfileDir` helper exposes the directory
  for future reuse.
- **Option B — Hash the absolute path into an opaque profile key.** Rejected: a
  hash removes the readable-listing requirement the design sets; a user could not
  tell which profile directory maps to which project without a lookup tool. The
  theoretical collision a readable encoding admits is a smaller cost than losing
  inspectability.
- **Option C — Keep the file in-tree but harden gitignore / add a `.opencode`
  subdir.** Rejected: it still leaves secret material in the working tree, one
  misconfiguration away from a commit, and does not give a single canonical home
  for other project-scoped persistence.
- **Option D — Auto-delete the legacy in-tree file after migrating it.** Rejected:
  destructive. The in-tree `config.json` is a common unrelated filename and may
  hold data opencode does not own; opencode surfaces it for the user to delete
  rather than removing it.

## Decision Outcome

Chosen option: **Option A**, because it removes the secret-leak vector by
confining per-project operator persistence to the user's private global profile,
keeps existing projects working through a non-destructive migration read-through,
stays human-inspectable on disk, and establishes one canonical per-project
directory for future persistence — all with zero operator-contract surface and an
unchanged CAS write/read alignment.

Key decisions recorded:

1. **Relocation + anchor (FR1).** Per-project persistence moves to
   `<Global.Path.config>/profiles/<ENCODED_ABSPATH>/config.json`. The directory is
   anchored on `Global.Path.config`, the same root that holds the global
   `config.json`, so it inherits any `OPENCODE_CONFIG_DIR` relocation of that root.
2. **Readable encoding (FR2).** The absolute path is resolved to a canonical form,
   then encoded: normalize Windows separators to POSIX, drop the leading
   separator, replace each separator with `-`, and sanitize any character outside
   `[A-Za-z0-9._-]` to `-`. `/Users/farchanjo/dev/cloudstack` →
   `Users-farchanjo-dev-cloudstack`.
3. **Readability-vs-collision trade-off (accepted).** Because a literal `-` in a
   path segment is indistinguishable from an encoded separator, two distinct paths
   can theoretically collide to one key (`/a/b` and `/a-b` both → `a-b`). This is
   accepted for a human-readable listing; a disambiguating hash suffix is NOT
   added because it breaks the readable requirement. The sanitization still bounds
   hostile path segments to a flat, single-segment filename that cannot traverse
   out of the profiles directory.
4. **Canonical directory helper (FR3).** `projectProfileDir(dir)` and
   `projectOperatorConfigPath(dir)` live in `config/project-profile.ts`;
   `projectProfileDir` is the reuse point for future project-scoped persistence
   (memory files and beyond).
5. **Seam moves (FR4, FR5).** The instance loader reads the relocated path; the
   write seam writes it with a recursive `writeWithDirs` that creates
   `profiles/<key>/` before writing. The write target remains the read target, so
   the Feature 014 CAS round-trip alignment holds.
6. **Non-destructive migration read-through (FR6).** When the relocated namespace
   is absent but a legacy in-tree operator namespace exists, the loader reads it so
   the project keeps working and emits one warning naming both paths, marking the
   in-tree file as a secret-leak vector to delete. opencode NEVER auto-deletes the
   legacy file. The next write persists to the relocated path.
7. **Env-flag behavior (FR7, invariant).** The profiles directory moves with
   `OPENCODE_CONFIG_DIR` via the `Global.Path.config` anchor. The
   `OPENCODE_DISABLE_PROJECT_CONFIG` gate is unchanged: the read seam lives inside
   the gate, so setting the flag skips the project namespace (relocated and legacy)
   entirely. `opencode.json`/`opencode.jsonc` discovery and global-scoped operator
   authorities are untouched.

### Consequences

- Good: project operator data (provider/MCP API keys) no longer lives in the
  working tree, closing the primary accidental-commit leak vector; it sits in the
  user's private, non-source-controlled global profile.
- Good: existing projects upgrade transparently — the legacy in-tree file is read
  through on first load and superseded on the next write, with a clear warning
  telling the user to delete the stray file.
- Good: one canonical per-project directory (`projectProfileDir`) now exists for
  all opencode-persisted project data, so future features reuse a single location.
- Good: zero operator-contract surface — no command id, catalog version, CAS
  authority, or config-discovery change; the write target stays the read target.
- Neutral (documented): the readable encoding admits a theoretical path→key
  collision (a literal `-` vs an encoded separator); accepted as the cost of a
  human-readable listing, with no hash suffix.
- Neutral (documented): the legacy in-tree file is intentionally left on disk
  until the user deletes it; opencode surfaces it but does not remove it.

## Related

- Feature specification: [027 Relocate per-project operator persistence out of the working tree](../sdd/027-relocate-per-project-operator-persistence-out-of-the-working/spec.md)
- The operator namespace write/read seam this feature relocates: [Feature 014 Wire the config-backed operator persistence and service](../sdd/014-complete-the-operator-control-plane-persistence-and-service/spec.md)
- The operator control plane + secret redaction posture the persisted namespace carries: [Feature 007 Unified native operator control plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- The operator mutation-plan handler contract + `mutateAuthority` pipeline + the SecretPort: [ADR-0017 Close the implementable operator capability gaps](0017-close-the-implementable-operator-capability-gaps-so-the.md)
