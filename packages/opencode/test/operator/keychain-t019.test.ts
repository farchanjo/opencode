/**
 * T019 OS keychain security review — mocked FFI only; NEVER real SecKeychain.
 */
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import {
  createMockDarwinSecurityFfi,
  createDarwinKeychainBackend,
  createDarwinNativeKeychainBackend,
  createMemoryKeychainBackend,
  createDurableKeychainSecretPort,
  createKeychainSecretPort,
  createMemoryConfigPort,
  createDurableOperatorStore,
  createFakeConfigService,
  createMockPointerIO,
  KEYCHAIN_SERVICE,
  allocateKeychainAccount,
  assertSecretName,
  SECRETS_AUTHORITY,
  OSSTATUS,
  mapOsStatus,
  selectKeychainBackend,
  isNotFoundStatus,
  isAuthFailedStatus,
} from "@/operator/adapters"
import { createProcessMutexLockPort } from "@/operator/application"
import { composeOperatorControlPlane } from "@/operator/main"
import { createMemoryEventPort } from "@/operator/adapters"

async function tmpDir() {
  const dir = path.join(
    process.env["TMPDIR"] ?? "/tmp",
    `opencode-t019-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await fs.mkdir(dir, { recursive: true })
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

describe("T019 H1 concurrent unique accounts", () => {
  test("allocateKeychainAccount is unique per nonce and bounded", () => {
    const a = allocateKeychainAccount({ projectKey: "p1", name: "openai", version: 1, nonce: "aaaaaaaaaaaaaaaa" })
    const b = allocateKeychainAccount({ projectKey: "p1", name: "openai", version: 1, nonce: "bbbbbbbbbbbbbbbb" })
    expect(a).not.toBe(b)
    expect(a.startsWith("oc.")).toBe(true)
    expect(a.includes("/")).toBe(false)
    expect(new TextEncoder().encode(a).byteLength).toBeLessThanOrEqual(256)
    // same project+name digest stable
    expect(a.split(".")[1]).toBe(b.split(".")[1])
  })

  test("two concurrent writers: unique accounts; winner durable; loser orphan cleaned", async () => {
    const config = createMemoryConfigPort()
    const ffi = createMockDarwinSecurityFfi()
    const backend = createDarwinKeychainBackend(ffi)
    const accountsWritten: string[] = []

    let releaseA!: () => void
    const aHold = new Promise<void>((r) => {
      releaseA = r
    })
    let aReachedPut = false
    let resolveAReached!: () => void
    const aReached = new Promise<void>((r) => {
      resolveAReached = r
    })

    const basePut = backend.put.bind(backend)
    const baseRemove = backend.remove.bind(backend)
    const removed: string[] = []

    const sharedBackend = {
      available: () => true,
      opCount: () => backend.opCount?.() ?? 0,
      async put(input: { service: string; account: string; secret: string }) {
        accountsWritten.push(input.account)
        await basePut(input)
        if (!aReachedPut) {
          aReachedPut = true
          resolveAReached()
          await aHold // A holds after first put so B can win CAS
        }
      },
      get: (i: { service: string; account: string }) => backend.get(i),
      exists: (i: { service: string; account: string }) => backend.exists(i),
      async remove(input: { service: string; account: string }) {
        removed.push(input.account)
        await baseRemove(input)
      },
    }

    const portA = createDurableKeychainSecretPort({
      backend: sharedBackend,
      config,
      projectKey: "proj",
      exposeInternalMaterial: true,
    })
    const portB = createDurableKeychainSecretPort({
      backend: sharedBackend,
      config,
      projectKey: "proj",
      exposeInternalMaterial: true,
    })

    const pA = portA.put({ backend: "keychain", name: "k", plaintext: "secret-A" })
    await aReached
    // B runs to completion while A is held after keychain write
    const rB = await portB.put({ backend: "keychain", name: "k", plaintext: "secret-B" })
    expect(rB.ok).toBe(true)
    if (!rB.ok) return
    releaseA()
    const rA = await pA
    // Both attempts used unique accounts
    expect(new Set(accountsWritten).size).toBe(accountsWritten.length)
    expect(accountsWritten.length).toBeGreaterThanOrEqual(2)

    // Durable metadata: current account exists and material matches that account
    const meta = await portB.readMeta?.()
    expect(meta?.secrets["k"]).toBeDefined()
    const current = meta!.secrets["k"]!.account
    const currentVersion = meta!.secrets["k"]!.currentVersion
    expect(await backend.exists({ service: KEYCHAIN_SERVICE, account: current })).toBe(true)

    // Internal material for current meta ref must match keychain item for current account
    const mat = await backend.get({ service: KEYCHAIN_SERVICE, account: current })
    expect(mat === "secret-A" || mat === "secret-B").toBe(true)
    // Winner of first CAS was B (secret-B) unless A retried to a higher version
    if (currentVersion === 1) {
      expect(mat).toBe("secret-B")
      expect(rB.value.version).toBe(1)
    } else {
      // A retried after B won — current is A's later write
      expect(currentVersion).toBeGreaterThanOrEqual(2)
      expect(mat).toBe("secret-A")
    }
    // Port-level internal resolve matches meta account material
    const viaPort = await portB.resolveSecretMaterial?.({
      backend: "keychain",
      name: "k",
      version: currentVersion,
    })
    expect(viaPort).toBe(mat)

    const entry = await config.get(SECRETS_AUTHORITY)
    expect(JSON.stringify(entry?.payload ?? {})).not.toContain("secret-A")
    expect(JSON.stringify(entry?.payload ?? {})).not.toContain("secret-B")
    // Loser orphan cleanup ran (A's first unique account or prior version)
    expect(removed.length).toBeGreaterThanOrEqual(1)
    // Removed accounts must not be the durable current (unless cleaned then re-written on retry)
    if (currentVersion === 1) {
      expect(removed).toContain(accountsWritten[0]!) // A's held first account
      expect(removed).not.toContain(current)
    }
    void rA
  })
})

describe("T019 H2/H3 pointer + bounds", () => {
  test("oversize native passwordLength rejected before copy; free/release still run", async () => {
    const ffi = createMockDarwinSecurityFfi({ oversizeFindLength: 999999 })
    const backend = createDarwinKeychainBackend(ffi)
    await backend.put({ service: KEYCHAIN_SERVICE, account: "x", secret: "ok" })
    await expect(backend.get({ service: KEYCHAIN_SERVICE, account: "x" })).rejects.toThrow(/bounds|param/i)
    expect(ffi.freeCount()).toBeGreaterThanOrEqual(1)
    expect(ffi.releaseCount()).toBeGreaterThanOrEqual(1)
  })

  test("mock PointerIO high-address read abstraction", () => {
    const high = BigInt("0x7fffffffffff")
    const io = createMockPointerIO({ highAddress: high })
    const out = io.allocOutPtr()
    const p = out.read()
    expect(p).toBe(high)
    expect(io.lastReadAddresses).toContain(high)
    const len = io.allocU32()
    len.view[0] = 42
    expect(len.read()).toBe(42)
  })
})

describe("T019 M2 attributes-only exists; M3 name namespace", () => {
  test("getRef does not load material (exists only)", async () => {
    const ffi = createMockDarwinSecurityFfi()
    const backend = createDarwinKeychainBackend(ffi)
    const config = createMemoryConfigPort()
    const port = createDurableKeychainSecretPort({
      backend,
      config,
      projectKey: "p",
      exposeInternalMaterial: true,
    })
    const put = await port.put({ backend: "keychain", name: "n", plaintext: "mat" })
    expect(put.ok).toBe(true)
    const loadsBefore = ffi.materialLoadCount()
    const ref = await port.getRef({ backend: "keychain", name: "n" })
    expect(ref.ok).toBe(true)
    expect(ffi.materialLoadCount()).toBe(loadsBefore) // no material load
  })

  test("reject slash/control in secret name", () => {
    expect(assertSecretName("a/b")?.code).toBe("invalid_argument")
    expect(assertSecretName("ok-name")).toBeNull()
  })

  test("OSStatus not-found vs auth distinct", () => {
    expect(isNotFoundStatus(OSSTATUS.errSecItemNotFound)).toBe(true)
    expect(isAuthFailedStatus(OSSTATUS.errSecAuthFailed)).toBe(true)
    expect(mapOsStatus(OSSTATUS.errSecItemNotFound).reason).toContain("not found")
    expect(mapOsStatus(OSSTATUS.errSecAuthFailed).reason).toContain("authentication")
    expect(mapOsStatus(OSSTATUS.errSecItemNotFound).reason).not.toBe(
      mapOsStatus(OSSTATUS.errSecAuthFailed).reason,
    )
  })
})

describe("T019 durable + sandbox + live composition M4", () => {
  test("put/rotate/restart preserves version; public redacted", async () => {
    await using tmp = await tmpDir()
    const lockDir = path.join(tmp.path, "locks")
    await fs.mkdir(lockDir, { recursive: true })
    const fake = createFakeConfigService()
    const lock = createProcessMutexLockPort()
    const store = createDurableOperatorStore({ config: fake, lock, projectKey: "p1" })
    const ffi = createMockDarwinSecurityFfi()
    const backend = createDarwinKeychainBackend(ffi)
    const port1 = createDurableKeychainSecretPort({
      backend,
      config: store.config,
      projectKey: "p1",
      exposeInternalMaterial: true,
    })
    const put = await port1.put({ backend: "keychain", name: "openai", plaintext: "sk_v1" })
    expect(put.ok).toBe(true)
    if (!put.ok) return
    const mat = await port1.resolveMaterial(put.value)
    expect(mat.ok && mat.value).toBe("__redacted__")
    const rot = await port1.rotate({ backend: "keychain", name: "openai", plaintext: "sk_v2" })
    expect(rot.ok && rot.value.version).toBe(2)
    const port2 = createDurableKeychainSecretPort({
      backend,
      config: store.config,
      projectKey: "p1",
      exposeInternalMaterial: true,
    })
    const ref = await port2.getRef({ backend: "keychain", name: "openai" })
    expect(ref.ok && ref.value.version).toBe(2)
  })

  test("sandbox zero ops; source scan", async () => {
    const sand = createDarwinNativeKeychainBackend({ sandbox: true, ffi: createMockDarwinSecurityFfi() })
    expect(sand.available()).toBe(false)
    expect(sand.opCount?.() ?? 0).toBe(0)
    const files = [
      "src/operator/adapters/outbound/keychain-darwin.ts",
      "src/operator/adapters/outbound/keychain-backend.ts",
      "src/operator/adapters/outbound/secret-keychain.ts",
      "src/operator/main.ts",
    ]
    for (const f of files) {
      const text = await Bun.file(path.join(import.meta.dir, "../../", f)).text()
      expect(text).not.toMatch(/security\s+-w/)
      expect(text).not.toMatch(/allowRealRunner/)
      expect(text).not.toMatch(/spawn\(.*security/)
    }
  })

  test("composeOperatorControlPlane live wires durable config+projectKey", async () => {
    await using tmp = await tmpDir()
    const lockDir = path.join(tmp.path, "locks")
    await fs.mkdir(lockDir, { recursive: true })
    const ffi = createMockDarwinSecurityFfi()
    const composed = await composeOperatorControlPlane({
      mode: "live",
      config: createFakeConfigService(),
      lockDir,
      projectKey: "live-proj",
      events: createMemoryEventPort(),
      keychainFfi: ffi,
    })
    const put = await composed.secrets.put({ backend: "keychain", name: "tok", plaintext: "x" })
    expect(put.ok).toBe(true)
    // durable meta under config authority
    const entry = await composed.store.config.get(SECRETS_AUTHORITY)
    expect(entry).toBeTruthy()
    expect(JSON.stringify(entry?.payload ?? {})).not.toContain("\"x\"")
  })
})

describe("T019 mock FFI add/find/update/delete", () => {
  test("basic lifecycle + no argv leak", async () => {
    const ffi = createMockDarwinSecurityFfi()
    const backend = createDarwinKeychainBackend(ffi)
    await backend.put({ service: KEYCHAIN_SERVICE, account: "n1", secret: "super-secret" })
    expect(await backend.exists({ service: KEYCHAIN_SERVICE, account: "n1" })).toBe(true)
    expect(await backend.get({ service: KEYCHAIN_SERVICE, account: "n1" })).toBe("super-secret")
    await backend.put({ service: KEYCHAIN_SERVICE, account: "n1", secret: "rotated" })
    expect(await backend.get({ service: KEYCHAIN_SERVICE, account: "n1" })).toBe("rotated")
    await backend.remove({ service: KEYCHAIN_SERVICE, account: "n1" })
    expect(await backend.exists({ service: KEYCHAIN_SERVICE, account: "n1" })).toBe(false)
    expect(process.argv.join(" ")).not.toContain("super-secret")
  })
})
