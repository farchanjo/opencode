import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Filesystem } from "@/util/filesystem"

/**
 * Feature 027: per-project opencode-persisted data lives OUT of the working tree.
 *
 * The project-scoped operator config used to be written to `<projectDir>/config.json`,
 * polluting every working directory and risking a secret leak (that file carries
 * provider/MCP API keys) into source trees. It now lives in the global profile store,
 * keyed by the full, resolved project path:
 *
 *   <Global.Path.config>/profiles/<ENCODED_ABSPATH>/config.json
 *
 * The profile directory is anchored on the operative config root: an explicit
 * `OPENCODE_CONFIG_DIR` override when set, otherwise the default global config dir
 * (`Global.Path.config`). Honoring the override is what lets an isolated profile
 * (e.g. `~/.opencodedev`) own its own `profiles/<key>/` tree instead of leaking back
 * into `~/.config/opencode`. This is the canonical home for ALL opencode-persisted
 * project data (operator config, memory files, and any future project-scoped
 * persistence); reuse `projectProfileDir` for those.
 */

const PROFILES_DIR = "profiles"

/**
 * The operative config root: the `OPENCODE_CONFIG_DIR` override when set, else the
 * default global config dir. Mirrors `Global.make()` (core/global.ts) so the profile
 * store lives under the same root a caller selected for the global config.
 */
function configRoot(): string {
  return Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config
}

/**
 * Encode an absolute project path into a readable, reversible-ish profile key.
 *
 * Rule (readability first — NOT an opaque hash): drop the leading separator, replace
 * every path separator with `-`, then sanitize any character outside `[A-Za-z0-9._-]`
 * to `-`. Example: `/Users/farchanjo/dev/cloudstack` -> `Users-farchanjo-dev-cloudstack`.
 *
 * The sanitization bounds hostile or exotic path segments to a flat, single-segment
 * filename that cannot escape the profiles directory (no `/`, `..`, NUL, or drive
 * colons survive). A literal `-` in a segment can theoretically collide (`/a/b` vs
 * `/a-b`); that is an accepted trade-off for a human-readable `ls profiles/` listing
 * (ADR-0027). A degenerate root path (`/`) that would sanitize to an empty key falls
 * back to `_root`, so the profile config never collapses onto `profiles/config.json`.
 */
const ROOT_KEY = "_root"

export function encodeProjectPathKey(absPath: string): string {
  const key = absPath
    .replace(/\\/g, "/") // normalize Windows separators to POSIX first
    .replace(/^\/+/, "") // drop the leading separator(s)
    .replace(/\//g, "-") // path separator -> readable dash
    .replace(/[^A-Za-z0-9._-]/g, "-") // sanitize everything else (drive colons, spaces, NUL, ...)
  return key.length > 0 ? key : ROOT_KEY
}

/**
 * The per-project profile directory: `<Global.Path.config>/profiles/<key>`.
 * The input directory is resolved to a canonical absolute path first, so the key is
 * stable regardless of symlinks or relative input.
 */
export function projectProfileDir(dir: string): string {
  return path.join(configRoot(), PROFILES_DIR, encodeProjectPathKey(Filesystem.resolve(dir)))
}

/** The relocated project operator config file: `<projectProfileDir>/config.json`. */
export function projectOperatorConfigPath(dir: string): string {
  return path.join(projectProfileDir(dir), "config.json")
}

export * as ProjectProfile from "./project-profile"
