/**
 * Sandbox path/bind/port/command policy (Feature 007 / T002–T003 review fix).
 * realpath containment under repo `.dev/opencode-operator`; exact port parsing.
 */
import fs from "fs"
import path from "path"
import {
  FORBIDDEN_OAUTH_PORT,
  FORBIDDEN_PROD_PORT,
  LOOPBACK_HOSTS,
  OPERATOR_BIND,
  OPERATOR_PORT,
  SANDBOX_ROOT_REL,
} from "./constants"

export type GuardOk = { ok: true }
export type GuardFail = { ok: false; reason: string }
export type GuardResult = GuardOk | GuardFail

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  if (LOOPBACK_HOSTS.has(normalized)) return true
  if (normalized === "::ffff:127.0.0.1") return true
  return false
}

export function assertLoopbackBind(host: string): GuardResult {
  if (!host || !isLoopbackHost(host)) {
    return {
      ok: false,
      reason: `operator bind must be loopback (${OPERATOR_BIND}); refused non-loopback host: ${host || "(empty)"}`,
    }
  }
  return { ok: true }
}

export function assertSafePort(port: number): GuardResult {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: `invalid port: ${port}` }
  }
  if (port === FORBIDDEN_PROD_PORT) {
    return {
      ok: false,
      reason: `port ${FORBIDDEN_PROD_PORT} is the production attach default and is forbidden in the operator sandbox (use ${OPERATOR_PORT})`,
    }
  }
  if (port === FORBIDDEN_OAUTH_PORT) {
    return {
      ok: false,
      reason: `port ${FORBIDDEN_OAUTH_PORT} is the real MCP OAuth callback port and is prohibited under the operator sandbox`,
    }
  }
  return { ok: true }
}

export function assertOperatorPort(port: number): GuardResult {
  const safe = assertSafePort(port)
  if (!safe.ok) return safe
  if (port !== OPERATOR_PORT) {
    return {
      ok: false,
      reason: `sandbox operator port must be ${OPERATOR_PORT}; refused ${port}`,
    }
  }
  return { ok: true }
}

export function isProdConfigPath(configDir: string, home: string): boolean {
  const resolved = safeRealpath(configDir) ?? path.resolve(configDir)
  const prod = safeRealpath(path.join(home, ".config", "opencode")) ?? path.resolve(home, ".config", "opencode")
  if (resolved === prod || resolved.startsWith(prod + path.sep)) return true
  const prodParent = path.resolve(home, ".config")
  if (resolved === prodParent) return true
  return false
}

export function assertNotProdConfigDir(configDir: string, home: string): GuardResult {
  if (!configDir) {
    return { ok: false, reason: "OPENCODE_CONFIG_DIR is required under the operator sandbox" }
  }
  if (isProdConfigPath(configDir, home)) {
    return {
      ok: false,
      reason: `OPENCODE_CONFIG_DIR must not resolve under production ~/.config/opencode (got ${configDir})`,
    }
  }
  return { ok: true }
}

/**
 * Canonical containment: realpath both sides; reject symlink escapes outside sandbox root.
 */
export function assertUnderSandboxRoot(target: string, sandboxRoot: string): GuardResult {
  const root = safeRealpath(sandboxRoot) ?? path.resolve(sandboxRoot)
  const resolved = safeRealpath(target) ?? path.resolve(target)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return {
      ok: false,
      reason: `path must stay under sandbox root ${root} (got ${resolved})`,
    }
  }
  return { ok: true }
}

/**
 * Ensure sandbox root is the repo-local `.dev/opencode-operator` (or under it).
 * Rejects external OPENCODE_CONFIG_DIR / SANDBOX_ROOT overrides outside repo.
 */
export function assertRepoSandboxLayout(input: {
  repoRoot: string
  configDir: string
  sandboxRoot?: string
}): GuardResult {
  const repo = safeRealpath(input.repoRoot) ?? path.resolve(input.repoRoot)
  const expectedRoot = path.join(repo, SANDBOX_ROOT_REL)
  const expectedReal = safeRealpath(expectedRoot) ?? path.resolve(expectedRoot)
  const sandboxRoot = input.sandboxRoot
    ? (safeRealpath(input.sandboxRoot) ?? path.resolve(input.sandboxRoot))
    : expectedReal

  // sandbox root must equal expected or be under it only if we allow nested — require exact expected root
  if (sandboxRoot !== expectedReal && !sandboxRoot.startsWith(expectedReal + path.sep)) {
    // Allow when expected does not exist yet (first run) and path string matches
    const expectedResolved = path.resolve(expectedRoot)
    if (path.resolve(input.sandboxRoot ?? expectedRoot) !== expectedResolved) {
      return {
        ok: false,
        reason: `sandbox root must be under ${expectedResolved} (got ${sandboxRoot})`,
      }
    }
  }

  const cfg = assertUnderSandboxRoot(input.configDir, sandboxRoot)
  if (!cfg.ok) return cfg

  // Reject if configDir realpath escapes to prod-like paths
  const cfgReal = safeRealpath(input.configDir) ?? path.resolve(input.configDir)
  if (cfgReal.includes(`${path.sep}.config${path.sep}opencode`) && !cfgReal.includes(`${path.sep}.dev${path.sep}`)) {
    return { ok: false, reason: `config dir resolves toward production path: ${cfgReal}` }
  }
  return { ok: true }
}

export function assertCommandPolicy(argv: string[]): GuardResult {
  const args = stripLeadingOpencode(argv)
  if (args.length === 0) return { ok: true }

  const head = args[0] ?? ""

  if (head === "service") {
    return { ok: false, reason: "service commands are forbidden in the operator sandbox" }
  }

  if (head === "opencode" || head.endsWith("/opencode") || head.endsWith("\\opencode")) {
    return { ok: false, reason: "bare/global opencode invocation is forbidden; use sandbox-rewritten local source only" }
  }

  // Forbid absolute path escapes to system binaries as command head
  if (head.startsWith("/") && !head.includes("packages/opencode")) {
    return { ok: false, reason: "absolute global command paths are forbidden in the operator sandbox" }
  }

  if (hasFlag(args, "--register")) {
    return { ok: false, reason: "serve --register / --register is forbidden in the operator sandbox" }
  }

  if (head === "mcp" && args.includes("auth")) {
    const oauthReal =
      hasFlag(args, "--oauth") ||
      hasFlag(args, "--real-oauth") ||
      args.includes("oauth") ||
      portInArgs(args, FORBIDDEN_OAUTH_PORT)
    if (oauthReal) {
      return {
        ok: false,
        reason: `real OAuth shortcuts and port ${FORBIDDEN_OAUTH_PORT} are prohibited under the operator sandbox`,
      }
    }
  }

  if (portInArgs(args, FORBIDDEN_PROD_PORT)) {
    return { ok: false, reason: `port ${FORBIDDEN_PROD_PORT} is forbidden in the operator sandbox` }
  }
  if (portInArgs(args, FORBIDDEN_OAUTH_PORT)) {
    return {
      ok: false,
      reason: `port ${FORBIDDEN_OAUTH_PORT} (MCP OAuth) is prohibited under the operator sandbox`,
    }
  }

  const hostname = flagValue(args, "--hostname")
  if (hostname) {
    const bind = assertLoopbackBind(hostname)
    if (!bind.ok) return bind
  }

  const portRaw = flagValue(args, "--port")
  if (portRaw !== undefined) {
    const port = Number(portRaw)
    if (!Number.isFinite(port)) {
      return { ok: false, reason: `invalid --port value: ${portRaw}` }
    }
    const safe = assertSafePort(port)
    if (!safe.ok) return safe
    if (head === "serve" || head === "web" || head === "attach") {
      const op = assertOperatorPort(port)
      if (!op.ok) return op
    }
  }

  if ((head === "serve" || head === "web") && hasFlag(args, "--mdns")) {
    return { ok: false, reason: "mDNS / non-loopback discovery is forbidden in the operator sandbox" }
  }

  return { ok: true }
}

export function stripLeadingOpencode(argv: string[]): string[] {
  if (argv[0] === "opencode") return argv.slice(1)
  if (argv[0] === "--" && argv[1] === "opencode") return argv.slice(2)
  if (argv[0] === "--") return argv.slice(1)
  return argv
}

export function withSandboxServeDefaults(argv: string[]): string[] {
  const args = stripLeadingOpencode(argv)
  if (args[0] !== "serve" && args[0] !== "web") return args
  const next = [...args]
  if (!hasFlag(next, "--port")) {
    next.push("--port", String(OPERATOR_PORT))
  }
  if (!hasFlag(next, "--hostname")) {
    next.push("--hostname", OPERATOR_BIND)
  }
  return next
}

function hasFlag(args: string[], name: string): boolean {
  return args.some((a) => a === name || a.startsWith(name + "="))
}

function flagValue(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === name) return args[i + 1]
    if (a.startsWith(name + "=")) return a.slice(name.length + 1)
  }
  return undefined
}

/**
 * Exact port match — `:40960` must NOT match port 4096.
 * Accepts `--port 4096`, `--port=4096`, and host:port where port is exact digits.
 */
function portInArgs(args: string[], port: number): boolean {
  const needle = String(port)
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === "--port" && args[i + 1] === needle) return true
    if (a === `--port=${needle}`) return true
    // Exact :port with non-digit boundary after
    const re = new RegExp(`(?:^|[\\s/@])(?:localhost|127\\.0\\.0\\.1|\\[::1\\])?:${needle}(?!\\d)`)
    if (re.test(a)) return true
    // bare :4096 not followed by digit
    const bare = new RegExp(`:${needle}(?!\\d)`)
    if (bare.test(a) && (a.includes("localhost") || a.includes("127.0.0.1") || a.startsWith(":"))) {
      return true
    }
  }
  return false
}

function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync.native(p)
  } catch {
    try {
      return fs.realpathSync(p)
    } catch {
      return null
    }
  }
}

export * as SandboxGuards from "./guards"
