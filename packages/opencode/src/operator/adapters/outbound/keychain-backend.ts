/**
 * Secure keychain backends (T019 / B4) — no plaintext secret on argv/env/files.
 * Tests inject mock backends / FFI symbols only; production selects Darwin FFI.
 * Sandbox composition always uses unavailable.
 */
import { createHash, randomBytes } from "node:crypto"

export const KEYCHAIN_SERVICE = "opencode.operator" as const
export const MAX_KEYCHAIN_SERVICE_BYTES = 256
export const MAX_KEYCHAIN_ACCOUNT_BYTES = 256
export const MAX_SECRET_NAME_CHARS = 128
export const MAX_SECRET_MATERIAL_BYTES = 64 * 1024

/** OSStatus codes we map (never include secret text). */
export const OSSTATUS = {
  errSecSuccess: 0,
  errSecItemNotFound: -25300,
  errSecDuplicateItem: -25299,
  errSecAuthFailed: -25293,
  errSecParam: -50,
  errSecAllocate: -108,
} as const

export type KeychainOsStatusError = {
  readonly code: "secret_backend" | "unavailable" | "invalid_argument"
  readonly osStatus: number
  readonly reason: string
}

/**
 * Distinct not-found vs auth vs generic. Never includes secret text.
 */
export function mapOsStatus(osStatus: number): KeychainOsStatusError {
  if (osStatus === OSSTATUS.errSecSuccess) {
    return { code: "secret_backend", osStatus, reason: "unexpected success mapping" }
  }
  if (osStatus === OSSTATUS.errSecItemNotFound) {
    return { code: "unavailable", osStatus, reason: "keychain item not found" }
  }
  if (osStatus === OSSTATUS.errSecAuthFailed) {
    return { code: "unavailable", osStatus, reason: "keychain authentication failed" }
  }
  if (osStatus === OSSTATUS.errSecParam) {
    return { code: "invalid_argument", osStatus, reason: "keychain parameter rejected" }
  }
  if (osStatus === OSSTATUS.errSecAllocate) {
    return { code: "secret_backend", osStatus, reason: "keychain allocate failed" }
  }
  if (osStatus === OSSTATUS.errSecDuplicateItem) {
    return { code: "secret_backend", osStatus, reason: "keychain duplicate item" }
  }
  return { code: "secret_backend", osStatus, reason: `keychain operation failed (${osStatus})` }
}

export function isNotFoundStatus(osStatus: number): boolean {
  return osStatus === OSSTATUS.errSecItemNotFound
}

export function isAuthFailedStatus(osStatus: number): boolean {
  return osStatus === OSSTATUS.errSecAuthFailed
}

export function assertKeychainFieldBounds(input: {
  service: string
  account: string
  secretBytes?: number
}): KeychainOsStatusError | null {
  const enc = new TextEncoder()
  if (enc.encode(input.service).byteLength > MAX_KEYCHAIN_SERVICE_BYTES) {
    return { code: "invalid_argument", osStatus: OSSTATUS.errSecParam, reason: "service name too long" }
  }
  if (enc.encode(input.account).byteLength > MAX_KEYCHAIN_ACCOUNT_BYTES) {
    return { code: "invalid_argument", osStatus: OSSTATUS.errSecParam, reason: "account name too long" }
  }
  if (input.secretBytes !== undefined && input.secretBytes > MAX_SECRET_MATERIAL_BYTES) {
    return { code: "invalid_argument", osStatus: OSSTATUS.errSecParam, reason: "secret material too large" }
  }
  if (input.secretBytes !== undefined && input.secretBytes < 1) {
    return { code: "invalid_argument", osStatus: OSSTATUS.errSecParam, reason: "secret material empty" }
  }
  return null
}

/**
 * Public secret name: no control chars, no slash (namespace collision-proof).
 */
export function assertSecretName(name: string): KeychainOsStatusError | null {
  if (!name || name.length > MAX_SECRET_NAME_CHARS) {
    return { code: "invalid_argument", osStatus: OSSTATUS.errSecParam, reason: "secret name invalid or too long" }
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return { code: "invalid_argument", osStatus: OSSTATUS.errSecParam, reason: "secret name has control characters" }
  }
  if (name.includes("/") || name.includes("\\")) {
    return { code: "invalid_argument", osStatus: OSSTATUS.errSecParam, reason: "secret name must not contain path separators" }
  }
  return null
}

/**
 * Unique keychain account per write attempt (H1).
 * Format: oc.<sha256(project|name)16>.v<version>.<nonce16>
 * - digest is collision-proof namespace (no raw project/name slash injection)
 * - nonce ensures two concurrent writers never share an account
 * - always within MAX_KEYCHAIN_ACCOUNT_BYTES
 */
export function allocateKeychainAccount(input: {
  readonly projectKey: string
  readonly name: string
  readonly version: number
  readonly nonce?: string
}): string {
  const digest = createHash("sha256")
    .update(String(input.projectKey ?? ""))
    .update("\0")
    .update(input.name)
    .digest("hex")
    .slice(0, 16)
  const nonce = (input.nonce ?? randomBytes(8).toString("hex")).replace(/[^a-f0-9]/gi, "").slice(0, 16)
  const account = `oc.${digest}.v${input.version}.${nonce || randomBytes(8).toString("hex")}`
  if (new TextEncoder().encode(account).byteLength > MAX_KEYCHAIN_ACCOUNT_BYTES) {
    // Truncate nonce if needed (should not happen with fixed lengths)
    return account.slice(0, MAX_KEYCHAIN_ACCOUNT_BYTES)
  }
  return account
}

/** @deprecated use allocateKeychainAccount — kept for tests migrating */
export function keychainAccountForVersion(
  name: string,
  version: number,
  projectKey?: string,
  nonce?: string,
): string {
  return allocateKeychainAccount({
    projectKey: projectKey ?? "project",
    name,
    version,
    nonce,
  })
}

export type KeychainBackend = {
  readonly put: (input: { service: string; account: string; secret: string }) => Promise<void>
  /**
   * Load material (internal only). Prefer exists() for getRef/status.
   */
  readonly get: (input: { service: string; account: string }) => Promise<string | null>
  /**
   * Existence / attributes-only check — MUST NOT load password bytes.
   * Returns true if item exists, false if not found, throws on auth/backend errors.
   */
  readonly exists: (input: { service: string; account: string }) => Promise<boolean>
  readonly remove: (input: { service: string; account: string }) => Promise<void>
  readonly available: () => boolean
  readonly opCount?: () => number
}

/** In-process mock — tests only. */
export function createMemoryKeychainBackend(): KeychainBackend & {
  readonly dumpKeys: () => string[]
  readonly opCount: () => number
} {
  const store = new Map<string, string>()
  let ops = 0
  const key = (s: string, a: string) => `${s}\0${a}`
  return {
    available: () => true,
    opCount: () => ops,
    async put(input) {
      ops += 1
      const bound = assertKeychainFieldBounds({
        service: input.service,
        account: input.account,
        secretBytes: new TextEncoder().encode(input.secret).byteLength,
      })
      if (bound) throw new Error(bound.reason)
      store.set(key(input.service, input.account), input.secret)
    },
    async get(input) {
      ops += 1
      return store.get(key(input.service, input.account)) ?? null
    },
    async exists(input) {
      ops += 1
      return store.has(key(input.service, input.account))
    },
    async remove(input) {
      ops += 1
      store.delete(key(input.service, input.account))
    },
    dumpKeys() {
      return [...store.keys()]
    },
  }
}

/** Always unavailable — sandbox default / non-darwin. */
export function createUnavailableKeychainBackend(reason = "os keychain unavailable"): KeychainBackend {
  return {
    available: () => false,
    opCount: () => 0,
    async put() {
      throw new Error(reason)
    },
    async get() {
      return null
    },
    async exists() {
      return false
    },
    async remove() {
      // no-op
    },
  }
}

/**
 * Low-level Darwin Security.framework surface (injectable for tests).
 */
export type DarwinSecurityFfi = {
  readonly addGenericPassword: (service: string, account: string, secret: Uint8Array) => number
  /**
   * Find with material: returns secret bytes (caller zeroizes) or null if not found.
   * On oversize native length: throws with secret_backend (after free/release).
   */
  readonly findGenericPassword: (service: string, account: string) => Uint8Array | null
  /**
   * Attributes-only find (null password out-params) — no material loaded.
   * true = exists, false = not found, throws Error with mapped reason on auth/other.
   */
  readonly existsGenericPassword: (service: string, account: string) => boolean
  readonly deleteGenericPassword: (service: string, account: string) => number
  readonly updateGenericPassword?: (service: string, account: string, secret: Uint8Array) => number
  readonly opCount?: () => number
}

export function createDarwinKeychainBackend(ffi: DarwinSecurityFfi): KeychainBackend {
  let ops = 0
  return {
    available: () => true,
    opCount: () => ops + (ffi.opCount?.() ?? 0),
    async put(input) {
      ops += 1
      const bytes = new TextEncoder().encode(input.secret)
      try {
        const bound = assertKeychainFieldBounds({
          service: input.service,
          account: input.account,
          secretBytes: bytes.byteLength,
        })
        if (bound) throw new Error(bound.reason)
        const code = ffi.addGenericPassword(input.service, input.account, bytes)
        if (code === OSSTATUS.errSecDuplicateItem && ffi.updateGenericPassword) {
          const u = ffi.updateGenericPassword(input.service, input.account, bytes)
          if (u !== OSSTATUS.errSecSuccess) throw new Error(mapOsStatus(u).reason)
          return
        }
        if (code === OSSTATUS.errSecDuplicateItem) {
          ffi.deleteGenericPassword(input.service, input.account)
          const again = ffi.addGenericPassword(input.service, input.account, bytes)
          if (again !== OSSTATUS.errSecSuccess) throw new Error(mapOsStatus(again).reason)
          return
        }
        if (code !== OSSTATUS.errSecSuccess) throw new Error(mapOsStatus(code).reason)
      } finally {
        bytes.fill(0)
      }
    },
    async get(input) {
      ops += 1
      const bytes = ffi.findGenericPassword(input.service, input.account)
      if (!bytes) return null
      try {
        return new TextDecoder().decode(bytes)
      } finally {
        bytes.fill(0)
      }
    },
    async exists(input) {
      ops += 1
      return ffi.existsGenericPassword(input.service, input.account)
    },
    async remove(input) {
      ops += 1
      const code = ffi.deleteGenericPassword(input.service, input.account)
      if (code !== OSSTATUS.errSecSuccess && code !== OSSTATUS.errSecItemNotFound) {
        throw new Error(mapOsStatus(code).reason)
      }
    },
  }
}

export function selectKeychainBackend(input: {
  sandbox: boolean
  platform?: string
  ffi?: DarwinSecurityFfi
}): KeychainBackend {
  if (input.sandbox) return createUnavailableKeychainBackend("keychain disabled under operator sandbox")
  if ((input.platform ?? process.platform) === "darwin" && input.ffi) {
    return createDarwinKeychainBackend(input.ffi)
  }
  return createUnavailableKeychainBackend("os keychain unavailable on this platform")
}

/**
 * Create a mock FFI (tests only). Simulates free/release and attributes-only exists.
 */
export function createMockDarwinSecurityFfi(options?: {
  readonly failAdd?: number
  readonly failFind?: number
  readonly failDelete?: number
  readonly failExists?: number
  /** When set, find reports this passwordLength before copy (H2 oversize test). */
  readonly oversizeFindLength?: number
}): DarwinSecurityFfi & {
  readonly store: Map<string, Uint8Array>
  readonly freeCount: () => number
  readonly releaseCount: () => number
  readonly materialLoadCount: () => number
} {
  const store = new Map<string, Uint8Array>()
  let ops = 0
  let frees = 0
  let releases = 0
  let materialLoads = 0
  const key = (s: string, a: string) => `${s}\0${a}`
  return {
    store,
    freeCount: () => frees,
    releaseCount: () => releases,
    materialLoadCount: () => materialLoads,
    opCount: () => ops,
    addGenericPassword(service, account, secret) {
      ops += 1
      if (options?.failAdd !== undefined) return options.failAdd
      const k = key(service, account)
      if (store.has(k)) return OSSTATUS.errSecDuplicateItem
      store.set(k, new Uint8Array(secret))
      return OSSTATUS.errSecSuccess
    },
    findGenericPassword(service, account) {
      ops += 1
      if (options?.failFind !== undefined) return null
      if (options?.oversizeFindLength !== undefined) {
        // Simulate: FreeContent + CFRelease still run; reject before copy
        frees += 1
        releases += 1
        throw new Error(mapOsStatus(OSSTATUS.errSecParam).reason + " (password length out of bounds)")
      }
      const found = store.get(key(service, account))
      if (!found) return null
      materialLoads += 1
      frees += 1
      releases += 1
      return new Uint8Array(found)
    },
    existsGenericPassword(service, account) {
      ops += 1
      if (options?.failExists === OSSTATUS.errSecAuthFailed) {
        throw new Error(mapOsStatus(OSSTATUS.errSecAuthFailed).reason)
      }
      if (options?.failExists === OSSTATUS.errSecItemNotFound) return false
      // attributes-only — no material load
      releases += 1
      return store.has(key(service, account))
    },
    deleteGenericPassword(service, account) {
      ops += 1
      if (options?.failDelete !== undefined) return options.failDelete
      const had = store.delete(key(service, account))
      releases += 1
      return had ? OSSTATUS.errSecSuccess : OSSTATUS.errSecItemNotFound
    },
    updateGenericPassword(service, account, secret) {
      ops += 1
      const k = key(service, account)
      if (!store.has(k)) return OSSTATUS.errSecItemNotFound
      store.set(k, new Uint8Array(secret))
      return OSSTATUS.errSecSuccess
    },
  }
}

export * as KeychainBackendModule from "./keychain-backend"
