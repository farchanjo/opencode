import { describe, expect, test } from "bun:test"
import path from "path"
import {
  buildSandboxEnv,
  ENV_CONFIG_DIR,
  ENV_DEV_OPERATOR,
  expectedGlobalPaths,
  OPERATOR_BIND,
  OPERATOR_PORT,
  resolveSandboxPaths,
  SANDBOX_ROOT_REL,
} from "@/dev/sandbox"

const repoRoot = path.resolve(import.meta.dir, "../../../../../")
const realHome = "/Users/prod-user-home-not-written"

describe("dev/sandbox env", () => {
  test("resolveSandboxPaths under repo .dev", () => {
    const paths = resolveSandboxPaths(repoRoot)
    expect(paths.root).toBe(path.join(repoRoot, SANDBOX_ROOT_REL))
    expect(paths.config.startsWith(paths.root + path.sep)).toBe(true)
    expect(paths.data).toContain(".dev/opencode-operator")
    expect(paths.home).toContain(".dev/opencode-operator/home")
    expect(paths.managed).toContain("managed")
  })

  test("buildSandboxEnv sets XDG/HOME/test vars before import contract", () => {
    const paths = resolveSandboxPaths(repoRoot)
    const env = buildSandboxEnv({ repoRoot, realHome })

    expect(env[ENV_DEV_OPERATOR]).toBe("1")
    expect(env[ENV_CONFIG_DIR]).toBe(paths.config)
    expect(env.XDG_CONFIG_HOME).toBe(paths.config)
    expect(env.XDG_DATA_HOME).toBe(paths.data)
    expect(env.XDG_CACHE_HOME).toBe(paths.cache)
    expect(env.XDG_STATE_HOME).toBe(paths.state)
    expect(env.TMPDIR).toBe(paths.tmp)
    expect(env.HOME).toBe(paths.home)
    expect(env.OPENCODE_TEST_HOME).toBe(paths.home)
    expect(env.OPENCODE_TEST_MANAGED_CONFIG_DIR).toBe(paths.managed)
    expect(env.OPENCODE_DISABLE_MODELS_FETCH).toBe("1")
    expect(env.OPENCODE_PURE).toBe("1")
    expect(env.OPENCODE_OPERATOR_PORT).toBe(String(OPERATOR_PORT))
    expect(env.OPENCODE_OPERATOR_BIND).toBe(OPERATOR_BIND)

    // Never points at real home prod config
    expect(env.XDG_CONFIG_HOME.includes(".dev/opencode-operator")).toBe(true)
    expect(env.HOME).not.toBe(realHome)
  })

  test("buildSandboxEnv rejects prod config override", () => {
    expect(() =>
      buildSandboxEnv({
        repoRoot,
        realHome,
        extra: { OPENCODE_CONFIG_DIR: path.join(realHome, ".config", "opencode") },
      }),
    ).toThrow(/production/)
  })

  test("expectedGlobalPaths nest under sandbox XDG roots", () => {
    const paths = resolveSandboxPaths(repoRoot)
    const expected = expectedGlobalPaths(paths)
    expect(expected.home).toBe(paths.home)
    expect(expected.config).toBe(path.join(paths.config, "opencode"))
    expect(expected.data).toBe(path.join(paths.data, "opencode"))
    expect(expected.cache).toBe(path.join(paths.cache, "opencode"))
    expect(expected.state).toBe(path.join(paths.state, "opencode"))
    expect(expected.tmp).toBe(path.join(paths.tmp, "opencode"))
    for (const p of Object.values(expected)) {
      expect(p.includes(".dev/opencode-operator") || p.startsWith(paths.root)).toBe(true)
    }
  })
})
