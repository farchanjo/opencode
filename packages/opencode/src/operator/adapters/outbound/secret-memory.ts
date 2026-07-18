/**
 * SecretPort adapters (T018–T021 / T019).
 * Keychain: durable Config metadata path preferred; memory map only for unit isolation.
 * Env-ref: CI only. Composite routes by backend.
 * Public resolveMaterial always __redacted__.
 */
import type { SecretRef } from "@opencode-ai/core/operator"
import type { ConfigPort } from "../../application/ports/config-port"
import type { SecretPort } from "../../application/ports/secret-port"
import {
  createMemoryKeychainBackend,
  createUnavailableKeychainBackend,
  selectKeychainBackend,
  type KeychainBackend,
  type DarwinSecurityFfi,
} from "./keychain-backend"
import {
  createDurableKeychainSecretPort,
  createKeychainSecretPortWithMap,
} from "./secret-keychain"

export function createMemorySecretPort(): SecretPort & {
  readonly resolveSecretMaterial: (ref: SecretRef) => Promise<string | null>
} {
  const backend = createMemoryKeychainBackend()
  const port = createKeychainSecretPortWithMap(backend, { exposeInternal: true })
  return port as SecretPort & {
    readonly resolveSecretMaterial: (ref: SecretRef) => Promise<string | null>
  }
}

/**
 * Keychain SecretPort.
 * - With `config`: durable version metadata under Config+Flock (production).
 * - Without `config`: in-memory version map (unit tests of backend only).
 * - sandbox / unavailable backend: fail closed.
 */
export function createKeychainSecretPort(options?: {
  readonly backend?: KeychainBackend
  readonly sandbox?: boolean
  readonly ffi?: DarwinSecurityFfi
  readonly platform?: string
  /** Durable Config under Flock — production path. */
  readonly config?: ConfigPort
  readonly nowMs?: () => number
  readonly projectKey?: string
  readonly exposeInternalMaterial?: boolean
}): SecretPort {
  if (options?.sandbox) {
    return createKeychainSecretPortWithMap(
      createUnavailableKeychainBackend("keychain disabled under operator sandbox"),
    )
  }
  const backend =
    options?.backend ??
    selectKeychainBackend({
      sandbox: false,
      platform: options?.platform,
      ffi: options?.ffi,
    })
  if (options?.config) {
    return createDurableKeychainSecretPort({
      backend,
      config: options.config,
      nowMs: options.nowMs,
      projectKey: options.projectKey,
      exposeInternalMaterial: options.exposeInternalMaterial,
    })
  }
  return createKeychainSecretPortWithMap(backend, {
    exposeInternal: options?.exposeInternalMaterial,
  })
}

export function createEnvRefSecretPort(env: Record<string, string | undefined> = process.env): SecretPort {
  const versions = new Map<string, number>()
  return {
    async put(input) {
      if (input.backend !== "env-ref") {
        return { ok: false, code: "invalid_argument", reason: "env-ref adapter only accepts backend=env-ref" }
      }
      if (!(input.name in env) || !env[input.name]) {
        return { ok: false, code: "secret_backend", reason: "env ref missing" }
      }
      const version = (versions.get(input.name) ?? 0) + 1
      versions.set(input.name, version)
      return { ok: true, value: { backend: "env-ref", name: input.name, version } }
    },
    async getRef(input) {
      if (!(input.name in env) || !env[input.name]) {
        return { ok: false, code: "secret_backend", reason: "env ref missing" }
      }
      return { ok: true, value: { backend: "env-ref", name: input.name, version: versions.get(input.name) ?? 1 } }
    },
    async resolveMaterial(ref) {
      if (!(ref.name in env) || !env[ref.name]) {
        return { ok: false, code: "secret_backend", reason: "env ref missing" }
      }
      return { ok: true, value: "__redacted__" }
    },
    async rotate(input) {
      return this.put(input)
    },
  }
}

export function createCompositeSecretPort(parts: { keychain: SecretPort; envRef: SecretPort }): SecretPort {
  return {
    async put(input) {
      if (input.backend === "keychain") return parts.keychain.put(input)
      return parts.envRef.put(input)
    },
    async getRef(input) {
      if (input.backend === "keychain") return parts.keychain.getRef(input)
      return parts.envRef.getRef(input)
    },
    async resolveMaterial(ref) {
      if (ref.backend === "keychain") return parts.keychain.resolveMaterial(ref)
      return parts.envRef.resolveMaterial(ref)
    },
    async rotate(input) {
      if (input.backend === "keychain") return parts.keychain.rotate(input)
      return parts.envRef.rotate(input)
    },
  }
}

export {
  createUnavailableKeychainBackend,
  createMemoryKeychainBackend,
  selectKeychainBackend,
  createMockDarwinSecurityFfi,
  KEYCHAIN_SERVICE,
  keychainAccountForVersion,
  allocateKeychainAccount,
  assertSecretName,
  isNotFoundStatus,
  isAuthFailedStatus,
  mapOsStatus,
  OSSTATUS,
} from "./keychain-backend"
export type { KeychainBackend, DarwinSecurityFfi } from "./keychain-backend"
export {
  createDurableKeychainSecretPort,
  createKeychainSecretPortWithMap,
  SECRETS_AUTHORITY,
} from "./secret-keychain"

export * as SecretAdapters from "./secret-memory"
