import { describe, expect, test } from "bun:test"
import path from "path"
import {
  assertCommandPolicy,
  assertLoopbackBind,
  assertNotProdConfigDir,
  assertOperatorPort,
  assertSafePort,
  assertUnderSandboxRoot,
  isLoopbackHost,
  isProdConfigPath,
  stripLeadingOpencode,
  withSandboxServeDefaults,
} from "@/dev/sandbox"
import { FORBIDDEN_OAUTH_PORT, FORBIDDEN_PROD_PORT, OPERATOR_BIND, OPERATOR_PORT } from "@/dev/sandbox"

describe("dev/sandbox guards", () => {
  test("loopback hosts accepted", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true)
    expect(isLoopbackHost("localhost")).toBe(true)
    expect(isLoopbackHost("::1")).toBe(true)
    expect(assertLoopbackBind(OPERATOR_BIND).ok).toBe(true)
  })

  test("non-loopback bind refused", () => {
    const r = assertLoopbackBind("0.0.0.0")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain("loopback")
  })

  test("safe port rejects production 4096 and oauth 19876", () => {
    expect(assertSafePort(OPERATOR_PORT).ok).toBe(true)
    expect(assertSafePort(FORBIDDEN_PROD_PORT).ok).toBe(false)
    expect(assertSafePort(FORBIDDEN_OAUTH_PORT).ok).toBe(false)
    expect(assertOperatorPort(OPERATOR_PORT).ok).toBe(true)
    expect(assertOperatorPort(8080).ok).toBe(false)
  })

  test("prod config path detection", () => {
    const home = "/Users/example"
    expect(isProdConfigPath(path.join(home, ".config", "opencode"), home)).toBe(true)
    expect(isProdConfigPath(path.join(home, ".config", "opencode", "nested"), home)).toBe(true)
    expect(isProdConfigPath("/repo/.dev/opencode-operator/config", home)).toBe(false)
    expect(assertNotProdConfigDir(path.join(home, ".config", "opencode"), home).ok).toBe(false)
    expect(assertNotProdConfigDir("/repo/.dev/opencode-operator/config", home).ok).toBe(true)
  })

  test("sandbox root containment", () => {
    const root = "/repo/.dev/opencode-operator"
    expect(assertUnderSandboxRoot(path.join(root, "config"), root).ok).toBe(true)
    expect(assertUnderSandboxRoot("/tmp/other", root).ok).toBe(false)
  })

  test("command policy rejects service, register, forbidden ports", () => {
    expect(assertCommandPolicy(["service", "install"]).ok).toBe(false)
    expect(assertCommandPolicy(["serve", "--register"]).ok).toBe(false)
    expect(assertCommandPolicy(["serve", "--port", String(FORBIDDEN_PROD_PORT)]).ok).toBe(false)
    expect(assertCommandPolicy(["serve", "--port", String(FORBIDDEN_OAUTH_PORT)]).ok).toBe(false)
    expect(assertCommandPolicy(["serve", "--hostname", "0.0.0.0"]).ok).toBe(false)
    expect(assertCommandPolicy(["serve", "--mdns"]).ok).toBe(false)
    expect(assertCommandPolicy(["mcp", "auth", "--oauth"]).ok).toBe(false)
    expect(assertCommandPolicy(["serve", "--port", String(OPERATOR_PORT), "--hostname", "127.0.0.1"]).ok).toBe(true)
  })

  test("stripLeadingOpencode and serve defaults", () => {
    expect(stripLeadingOpencode(["opencode", "serve"])).toEqual(["serve"])
    expect(stripLeadingOpencode(["--", "opencode", "serve"])).toEqual(["serve"])
    const withDefaults = withSandboxServeDefaults(["opencode", "serve"])
    expect(withDefaults).toContain("--port")
    expect(withDefaults).toContain(String(OPERATOR_PORT))
    expect(withDefaults).toContain("--hostname")
    expect(withDefaults).toContain(OPERATOR_BIND)
  })
})
