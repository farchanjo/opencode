import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { FORBIDDEN_OAUTH_PORT, FORBIDDEN_PROD_PORT, OPERATOR_PORT } from "@/dev/sandbox"

const repoRoot = path.resolve(import.meta.dir, "../../../../../")
const wrapper = path.join(repoRoot, "scripts/dev/opencode-operator-sandbox")

async function runWrapper(args: string[], opts?: { env?: Record<string, string>; timeoutMs?: number }) {
  const proc = Bun.spawn([wrapper, ...args], {
    cwd: repoRoot,
    env: {
      // Minimal env: do not leak test-preload XDG into the wrapper process.
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...opts?.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const timeoutMs = opts?.timeoutMs ?? 10_000
  const timed = Promise.race([
    Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        try {
          proc.kill()
        } catch {
          // already exited
        }
        reject(new Error(`wrapper timed out after ${timeoutMs}ms: ${args.join(" ")}`))
      }, timeoutMs)
    }),
  ])
  const [stdout, stderr, exitCode] = await timed
  return { stdout, stderr, exitCode }
}

describe("dev/sandbox wrapper", () => {
  test("wrapper script is executable and present", async () => {
    const st = await fs.stat(wrapper)
    expect(st.isFile()).toBe(true)
    // owner executable bit (unix)
    expect((st.mode & 0o111) !== 0).toBe(true)
  })

  test("rejects service commands", async () => {
    const r = await runWrapper(["--", "opencode", "service", "install"])
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr + r.stdout).toMatch(/service/i)
  })

  test("rejects serve --register", async () => {
    const r = await runWrapper(["serve", "--register"])
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/register/i)
  })

  test("rejects production port 4096", async () => {
    const r = await runWrapper(["serve", "--port", String(FORBIDDEN_PROD_PORT)])
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(new RegExp(String(FORBIDDEN_PROD_PORT)))
  })

  test("rejects oauth port 19876", async () => {
    const r = await runWrapper(["serve", "--port", String(FORBIDDEN_OAUTH_PORT)])
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(new RegExp(String(FORBIDDEN_OAUTH_PORT)))
  })

  test("rejects non-loopback hostname", async () => {
    const r = await runWrapper(["serve", "--port", String(OPERATOR_PORT), "--hostname", "0.0.0.0"])
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/loopback|bind/i)
  })

  test("rejects bare global opencode token as command", async () => {
    // After stripping one leading opencode, a remaining bare opencode is rejected
    const r = await runWrapper(["opencode", "opencode", "version"])
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/global|bare|forbidden/i)
  })

  test("creates sandbox layout under .dev without secrets file", async () => {
    // Help path creates layout then exits 2
    await runWrapper([])
    const root = path.join(repoRoot, ".dev/opencode-operator")
    for (const dir of ["config", "data", "cache", "state", "tmp", "home", "managed", "logs"]) {
      const st = await fs.stat(path.join(root, dir))
      expect(st.isDirectory()).toBe(true)
    }
    // No secrets env file should be created by the wrapper
    const entries = await fs.readdir(root)
    expect(entries.some((e) => /secret|\.env/i.test(e))).toBe(false)
  })
})
