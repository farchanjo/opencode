/**
 * T004 proof: production path metadata unchanged; sandbox Global.Path under .dev.
 *
 * Metadata-only snapshots (names + mtimeMs + size). Never reads file contents/secrets.
 * Global.Path import happens in a child process AFTER env is set.
 */
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  buildSandboxEnv,
  expectedGlobalPaths,
  OPERATOR_PORT,
  resolveSandboxPaths,
  SANDBOX_ROOT_REL,
} from "@/dev/sandbox"

const repoRoot = path.resolve(import.meta.dir, "../../../../../")
const wrapper = path.join(repoRoot, "scripts/dev/opencode-operator-sandbox")

/** Real user home — NOT the package test preload home. */
const realHome = os.homedir()

type EntryMeta = {
  name: string
  mtimeMs: number
  size: number
  isDir: boolean
}

type DirSnapshot = {
  exists: boolean
  entries: EntryMeta[]
}

/**
 * Exclude known externally mutable runtime files from prod snapshot equality.
 * Documented reason: SQLite WAL/SHM and active log files churn without operator control-plane writes.
 * Never exclude auth.json, config.json, server state, or credential files.
 */
function isExcludedVolatileName(name: string): boolean {
  if (name.endsWith(".db-wal") || name.endsWith(".db-shm")) return true
  if (name.endsWith(".log") || name === "logs") return true
  return false
}

async function snapshotDir(dir: string): Promise<DirSnapshot> {
  try {
    const names = await fs.readdir(dir)
    const entries: EntryMeta[] = []
    for (const name of names.sort()) {
      if (isExcludedVolatileName(name)) continue
      // Metadata only — never open file contents
      const st = await fs.lstat(path.join(dir, name))
      entries.push({
        name,
        mtimeMs: st.mtimeMs,
        size: st.size,
        isDir: st.isDirectory(),
      })
    }
    return { exists: true, entries }
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
      return { exists: false, entries: [] }
    }
    throw error
  }
}

function prodDirs(home: string) {
  return {
    config: path.join(home, ".config", "opencode"),
    data: path.join(home, ".local", "share", "opencode"),
    cache: path.join(home, ".cache", "opencode"),
    state: path.join(home, ".local", "state", "opencode"),
  }
}

function redactPath(p: string) {
  if (p.startsWith(realHome)) return "~" + p.slice(realHome.length)
  return p
}

describe("dev/sandbox prod path proof (T004)", () => {
  test("default path constants without wrapper point at real XDG shape (not .dev)", () => {
    // Document production shape: without sandbox env, config lives under ~/.config/opencode
    const dirs = prodDirs(realHome)
    expect(dirs.config.endsWith(path.join(".config", "opencode"))).toBe(true)
    expect(dirs.config.includes(SANDBOX_ROOT_REL)).toBe(false)
    // Production attach default is 4096; sandbox uses 14096
    expect(OPERATOR_PORT).toBe(14096)
    expect(OPERATOR_PORT).not.toBe(4096)
  })

  test("child import after sandbox env: Global.Path under repo .dev, not real home", async () => {
    const paths = resolveSandboxPaths(repoRoot)
    await fs.mkdir(paths.tmp, { recursive: true })
    for (const d of ["config", "data", "cache", "state", "tmp", "home", "managed"]) {
      await fs.mkdir(path.join(paths.root, d), { recursive: true })
    }
    // version marker so Global mkdir/version logic is calm
    await fs.mkdir(path.join(paths.cache, "opencode"), { recursive: true })
    await fs.writeFile(path.join(paths.cache, "opencode", "version"), "14")

    const env = buildSandboxEnv({ repoRoot, realHome })
    const expected = expectedGlobalPaths(paths)

    // Critical: env set in child BEFORE any import of @opencode-ai/core/global
    const script = `
      const g = await import("@opencode-ai/core/global");
      const Path = g.Path;
      const out = {
        home: Path.home,
        config: Path.config,
        data: Path.data,
        cache: Path.cache,
        state: Path.state,
        tmp: Path.tmp,
      };
      process.stdout.write(JSON.stringify(out));
    `

    const proc = Bun.spawn(["bun", "-e", script], {
      cwd: path.join(repoRoot, "packages/opencode"),
      env: {
        PATH: process.env.PATH,
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(exitCode).toBe(0)
    if (exitCode !== 0) {
      throw new Error(`child failed: ${stderr}`)
    }
    const actual = JSON.parse(stdout) as Record<string, string>

    expect(actual.home).toBe(expected.home)
    expect(actual.config).toBe(expected.config)
    expect(actual.data).toBe(expected.data)
    expect(actual.cache).toBe(expected.cache)
    expect(actual.state).toBe(expected.state)
    expect(actual.tmp).toBe(expected.tmp)

    const prod = prodDirs(realHome)
    for (const [key, value] of Object.entries(actual)) {
      expect(value.includes(".dev/opencode-operator"), `${key}=${redactPath(value)}`).toBe(true)
      // Sandbox may live under the user's home tree (~/dev/...), but must not be prod XDG paths
      expect(value === realHome, `${key} must not equal real HOME`).toBe(false)
      expect(value === prod.config || value.startsWith(prod.config + path.sep), `${key} not prod config`).toBe(false)
      expect(value === prod.data || value.startsWith(prod.data + path.sep), `${key} not prod data`).toBe(false)
      expect(value === prod.cache || value.startsWith(prod.cache + path.sep), `${key} not prod cache`).toBe(false)
      expect(value === prod.state || value.startsWith(prod.state + path.sep), `${key} not prod state`).toBe(false)
    }
  })

  test("wrapper layout + Global.Path child write only under .dev; prod metadata unchanged", async () => {
    const dirs = prodDirs(realHome)
    const before: Record<string, DirSnapshot> = {}
    for (const [k, p] of Object.entries(dirs)) {
      before[k] = await snapshotDir(p)
    }

    // Prefer unit-level proof: no live server / full CLI boot (T001–T004).
    // 1) wrapper empty invocation creates layout and exits without touching prod
    const layout = Bun.spawn([wrapper], {
      cwd: repoRoot,
      env: { PATH: process.env.PATH, HOME: realHome },
      stdout: "pipe",
      stderr: "pipe",
    })
    const layoutCode = await layout.exited
    expect(layoutCode).toBe(2)

    // 2) child Global.Path import under sandbox env (writes only under .dev)
    const paths = resolveSandboxPaths(repoRoot)
    const env = buildSandboxEnv({ repoRoot, realHome })
    const script = `
      const g = await import("@opencode-ai/core/global");
      const marker = ${JSON.stringify(path.join(paths.config, "opencode", ".sandbox-marker"))};
      await Bun.write(marker, "ok");
      process.stdout.write(JSON.stringify({ config: g.Path.config, wrote: marker }));
    `
    const child = Bun.spawn(["bun", "-e", script], {
      cwd: path.join(repoRoot, "packages/opencode"),
      env: { PATH: process.env.PATH, ...env },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(exitCode, stderr).toBe(0)
    const body = JSON.parse(stdout) as { config: string; wrote: string }
    expect(body.config.includes(".dev/opencode-operator")).toBe(true)
    expect(body.wrote.includes(".dev/opencode-operator")).toBe(true)

    const after: Record<string, DirSnapshot> = {}
    for (const [k, p] of Object.entries(dirs)) {
      after[k] = await snapshotDir(p)
    }

    for (const key of Object.keys(dirs)) {
      expect(after[key]!.exists).toBe(before[key]!.exists)
      expect(after[key]!.entries).toEqual(before[key]!.entries)
    }

    const sandboxRoot = path.join(repoRoot, SANDBOX_ROOT_REL)
    const st = await fs.stat(sandboxRoot)
    expect(st.isDirectory()).toBe(true)
  })

  test("gitignore covers .dev sandbox paths", async () => {
    const check = Bun.spawn(["git", "check-ignore", "-v", ".dev/opencode-operator/config"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, exitCode] = await Promise.all([new Response(check.stdout).text(), check.exited])
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/\.dev/)
  })
})
