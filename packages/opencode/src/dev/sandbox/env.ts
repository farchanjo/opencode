import path from "path"
import {
  ENV_CONFIG_DIR,
  ENV_DEV_OPERATOR,
  ENV_OPERATOR_BIND,
  ENV_OPERATOR_PORT,
  OPERATOR_BIND,
  OPERATOR_PORT,
  SAFE_DEFAULT_ENV,
  SANDBOX_LAYOUT,
  SANDBOX_ROOT_REL,
} from "./constants"
import { assertNotProdConfigDir, assertRepoSandboxLayout, assertUnderSandboxRoot } from "./guards"

export type SandboxPaths = {
  root: string
  config: string
  data: string
  cache: string
  state: string
  tmp: string
  home: string
  managed: string
  logs: string
}

export type BuildSandboxEnvInput = {
  /** Absolute path to the repository root (contains packages/opencode). */
  repoRoot: string
  /** Real user home used only for prod-path rejection (not written). */
  realHome: string
  /** Optional override of sandbox root (defaults to repoRoot/.dev/opencode-operator). */
  sandboxRoot?: string
  /** Extra env merged last (caller overrides). */
  extra?: Record<string, string | undefined>
}

/**
 * Resolve the Feature 007 sandbox directory layout under the repo.
 * Does not create directories — callers (wrapper) mkdir as needed.
 */
export function resolveSandboxPaths(repoRoot: string, sandboxRoot = path.join(repoRoot, SANDBOX_ROOT_REL)): SandboxPaths {
  const root = path.resolve(sandboxRoot)
  return {
    root,
    config: path.join(root, "config"),
    data: path.join(root, "data"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    home: path.join(root, "home"),
    managed: path.join(root, "managed"),
    logs: path.join(root, "logs"),
  }
}

/**
 * Build the isolation environment that MUST be exported before any Bun/core import.
 *
 * Sets XDG_*, TMPDIR, HOME, OPENCODE_TEST_*, OPENCODE_CONFIG_DIR, operator port/bind,
 * and safe defaults (PURE, DISABLE_MODELS_FETCH, ...).
 *
 * Does not mutate process.env — returns a plain record for the wrapper / child spawn.
 */
export function buildSandboxEnv(input: BuildSandboxEnvInput): Record<string, string> {
  const paths = resolveSandboxPaths(input.repoRoot, input.sandboxRoot)

  // Canonical containment for all layout dirs before env export
  for (const dir of [paths.root, paths.config, paths.data, paths.cache, paths.state, paths.tmp, paths.home, paths.managed]) {
    const under = assertUnderSandboxRoot(dir, paths.root)
    if (!under.ok) throw new Error(under.reason)
  }

  const layout = assertRepoSandboxLayout({
    repoRoot: input.repoRoot,
    configDir: paths.config,
    sandboxRoot: paths.root,
  })
  if (!layout.ok) throw new Error(layout.reason)

  const notProd = assertNotProdConfigDir(paths.config, input.realHome)
  if (!notProd.ok) throw new Error(notProd.reason)

  const env: Record<string, string> = {
    [ENV_DEV_OPERATOR]: "1",
    [ENV_OPERATOR_PORT]: String(OPERATOR_PORT),
    [ENV_OPERATOR_BIND]: OPERATOR_BIND,
    [ENV_CONFIG_DIR]: paths.config,

    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_CACHE_HOME: paths.cache,
    XDG_STATE_HOME: paths.state,
    TMPDIR: paths.tmp,
    TMP: paths.tmp,
    TEMP: paths.tmp,

    HOME: paths.home,
    OPENCODE_TEST_HOME: paths.home,
    OPENCODE_TEST_MANAGED_CONFIG_DIR: paths.managed,

    ...SAFE_DEFAULT_ENV,
  }

  if (input.extra) {
    for (const [key, value] of Object.entries(input.extra)) {
      if (value !== undefined) env[key] = value
    }
  }

  // Re-validate after overrides (reject symlink escape / external root / prod)
  const finalConfig = env[ENV_CONFIG_DIR] ?? paths.config
  const recheck = assertNotProdConfigDir(finalConfig, input.realHome)
  if (!recheck.ok) throw new Error(recheck.reason)
  const finalLayout = assertRepoSandboxLayout({
    repoRoot: input.repoRoot,
    configDir: finalConfig,
    sandboxRoot: paths.root,
  })
  if (!finalLayout.ok) throw new Error(finalLayout.reason)
  for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "TMPDIR", "HOME"] as const) {
    const val = env[key]
    if (!val) continue
    const under = assertUnderSandboxRoot(val, paths.root)
    if (!under.ok) throw new Error(`${key}: ${under.reason}`)
  }

  return env
}

/** Expected Global.Path values once env is applied and @opencode-ai/core/global is imported. */
export function expectedGlobalPaths(paths: SandboxPaths) {
  return {
    home: paths.home,
    config: path.join(paths.config, "opencode"),
    data: path.join(paths.data, "opencode"),
    cache: path.join(paths.cache, "opencode"),
    state: path.join(paths.state, "opencode"),
    tmp: path.join(paths.tmp, "opencode"),
  }
}

export function sandboxLayoutDirs(): readonly string[] {
  return SANDBOX_LAYOUT
}

export * as SandboxEnv from "./env"
