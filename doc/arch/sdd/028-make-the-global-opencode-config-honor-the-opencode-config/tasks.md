# Tasks: Make The Global Opencode Config Honor The Opencode Config

## Task Breakdown

- [x] T001 Add the `configRoot()` resolver in `packages/opencode/src/config/config.ts`
      returning `Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config` (FR1).
- [x] T002 Move `globalConfigFile()` candidate resolution onto `configRoot()` (FR2),
      so the global config WRITE target honors the override.
- [x] T003 Move the `loadGlobal()` reads of `config.json` / `opencode.json` /
      `opencode.jsonc`, the legacy `config` TOML dir read, and its `config.json`
      rewrite onto `configRoot()` (FR2).
- [x] T004 Move the global merge source from `Global.Path.config` to `configRoot()`
      (FR2), keeping plugin-origin provenance accurate.
- [x] T005 Guard the directories-loop `opencode.json`/`opencode.jsonc` file-load with
      `dir !== configRoot()` to prevent the double-load; keep the rest of the loop
      body running for the config root (FR5).
- [x] T006 Verify project-over-global precedence is preserved after the seam move
      (FR4) and that default (override-unset) resolution is byte-for-byte unchanged
      (FR3).
- [x] T007 Confirm credentials safety: `auth.json` resolves from `Global.Path.data`,
      out of the config root, and no seam moved here touches auth (FR6).
- [x] T008 Add colocated tests in `packages/opencode/test/config/`: global read +
      write honor the override; precedence preserved; no array duplication; override
      unset unchanged; auth untouched.
- [x] T009 Author the speckit corpus (spec, plan, tasks) and ADR-0028; leave
      `validate` and `analyze` green.

## Dependencies

- Feature 027 (`027-relocate-per-project-operator-persistence-out-of-the-working`)
  must be in place: it introduced the `configRoot` pattern for the per-project
  profile store and documented the global-seam residual this feature closes.
- No external systems or services are required.
