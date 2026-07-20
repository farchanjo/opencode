export * as ConfigRoot from "./config-root"

import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"

/**
 * Feature 031: the shared operative config root — the single resolver every config
 * seam (server config, per-project profile store, tui config) must use for the
 * profile-override directory.
 *
 * `configRoot()` mirrors `Global.make()` (core/global.ts): when `OPENCODE_CONFIG_DIR`
 * is set it points there, so an isolated profile (e.g. `~/.opencodedev`) captures
 * config WRITES and layers as a config-READ override without mutating the real
 * global dir; when unset it is `Global.Path.config`, so `configRoot() ===
 * Global.Path.config` is the "no profile layer" sentinel every caller checks before
 * adding a second merge source.
 *
 * Extracted in Feature 031 to DRY the definition previously duplicated between
 * `config.ts` and `project-profile.ts` — both now import this one implementation, and
 * `tui.ts` reuses it for its own profile layer instead of reading `Flag.OPENCODE_CONFIG_DIR`
 * directly. Behavior is unchanged: this is a pure extraction, not a semantic change.
 */
export function configRoot(): string {
  return Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config
}
