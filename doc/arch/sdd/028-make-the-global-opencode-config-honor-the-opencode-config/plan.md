# Implementation Plan: Make The Global Opencode Config Honor The Opencode Config

## Overview

Feature 027 relocated the PER-PROJECT operator config into
`<configRoot>/profiles/<key>/config.json`, where `configRoot =
Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config`. But the GLOBAL config in
`packages/opencode/src/config/config.ts` still anchors every seam on the raw
`Global.Path.config` — the fixed XDG dir (`~/.config/opencode`) that never reads
the override. An isolated profile therefore owns its `profiles/` tree but its
global `config.json` still resolves to `~/.config/opencode`. This feature aligns
the global config seams with the same operative config root, closing the residual
documented in ADR-0027.

## Technical Approach

- **`configRoot()` resolver.** Add a small helper in `config.ts` returning
  `Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config`, mirroring `Global.make()`. It
  is the single source of the global config-file location.
- **Seam moves.** Replace the raw `Global.Path.config` with `configRoot()` at every
  global config seam: `globalConfigFile()` candidate resolution; the `loadGlobal()`
  reads of `config.json` / `opencode.json` / `opencode.jsonc`; the legacy `config`
  (TOML) dir read and its `config.json` rewrite; and the global merge source. The
  write seam (`updateGlobal`) resolves its target through `globalConfigFile()`, so
  it honors the override automatically.
- **Double-load prevention.** The directories loop already loads
  `opencode.json`/`opencode.jsonc` from `OPENCODE_CONFIG_DIR`. Once the global loader
  also loads those two from `configRoot()`, the same files would load twice. Guard
  the inner file-load block with `dir !== configRoot()` so the config root is loaded
  once (by the global loader); the rest of the loop body still runs for that dir.
- **Precedence.** The merge order is unchanged: the global config merges first, then
  the per-project operator namespace layers on top — project-over-global is
  preserved. The move only changes WHERE the global config is read from, not its
  merge position.
- **Credentials safety.** Auth material (`auth.json`) resolves from
  `Global.Path.data` in `src/auth/index.ts`, out of the config root; no seam moved
  here reads or writes auth. Verified: this change touches config-file resolution
  only.
- **Tests.** Colocated in `packages/opencode/test/config/`: global `config.json`
  read + write honor the override; project-over-global precedence preserved; no
  array duplication from the double-load; override unset resolves the default root
  unchanged; auth untouched.

## Companion Artifacts

No companion artifacts are required for this feature. The change is a localized
seam alignment in a single module; the decision record lives in
`doc/arch/adr/0028-make-the-global-opencode-config-honor-the-opencode-config.md`.
