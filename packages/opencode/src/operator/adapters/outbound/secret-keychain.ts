/**
 * Keychain SecretPort with durable version metadata in Config under Flock (T019).
 *
 * H1: unique account per write attempt (digest + version + crypto nonce);
 *     metadata stores exact account; loser CAS deletes only its orphan.
 * M2: getRef uses exists() — no material load.
 * Public resolveMaterial always __redacted__.
 */
import type { SecretRef } from "@opencode-ai/core/operator"
import type { ConfigPort } from "../../application/ports/config-port"
import type { SecretPort, SecretPortResult } from "../../application/ports/secret-port"
import {
  allocateKeychainAccount,
  assertSecretName,
  KEYCHAIN_SERVICE,
  MAX_SECRET_MATERIAL_BYTES,
  type KeychainBackend,
} from "./keychain-backend"

export const SECRETS_AUTHORITY = "operator.secrets" as const

export type SecretMetaEntry = {
  readonly currentVersion: number
  /** Exact keychain account for current version (unique per write attempt). */
  readonly account: string
}

export type SecretsPayload = {
  readonly secrets: Record<string, SecretMetaEntry>
}

export type SecretMaterial = {
  readonly __brand: "SecretMaterial"
  readonly bytes: Uint8Array
}

export function createSecretMaterial(text: string): SecretMaterial {
  return { __brand: "SecretMaterial", bytes: new TextEncoder().encode(text) }
}

export function zeroizeSecretMaterial(material: SecretMaterial): void {
  material.bytes.fill(0)
}

function asPayload(raw: unknown): SecretsPayload {
  if (!raw || typeof raw !== "object") return { secrets: {} }
  const secrets = (raw as { secrets?: Record<string, SecretMetaEntry> }).secrets
  if (!secrets || typeof secrets !== "object") return { secrets: {} }
  return { secrets: { ...secrets } }
}

export type CreateDurableKeychainSecretPortInput = {
  readonly backend: KeychainBackend
  readonly config: ConfigPort
  readonly nowMs?: () => number
  readonly projectKey?: string
  readonly exposeInternalMaterial?: boolean
}

export function createDurableKeychainSecretPort(
  input: CreateDurableKeychainSecretPortInput,
): SecretPort & {
  readonly resolveSecretMaterial?: (ref: SecretRef) => Promise<string | null>
  readonly readMeta?: () => Promise<SecretsPayload>
} {
  const backend = input.backend
  const config = input.config
  const nowMs = input.nowMs ?? (() => Date.now())
  const projectKey = input.projectKey ?? "project"

  async function loadMeta(): Promise<{ payload: SecretsPayload; version: string | null }> {
    const entry = await config.get(SECRETS_AUTHORITY)
    if (!entry) return { payload: { secrets: {} }, version: null }
    return { payload: asPayload(entry.payload), version: entry.version }
  }

  async function casMeta(
    expectedVersion: string | null,
    payload: SecretsPayload,
  ): Promise<SecretPortResult<true>> {
    const cas = await config.compareAndSet({
      authority: SECRETS_AUTHORITY,
      expectedVersion,
      payload,
      nowMs: nowMs(),
    })
    if (cas.ok) return { ok: true, value: true }
    if (cas.code === "conflict") {
      return { ok: false, code: "secret_backend", reason: "secret metadata CAS conflict" }
    }
    return { ok: false, code: "unavailable", reason: cas.reason }
  }

  async function deleteOrphan(account: string) {
    try {
      await backend.remove({ service: KEYCHAIN_SERVICE, account })
    } catch {
      // best-effort orphan cleanup
    }
  }

  const port: SecretPort & {
    resolveSecretMaterial?: (ref: SecretRef) => Promise<string | null>
    readMeta?: () => Promise<SecretsPayload>
  } = {
    async put(req) {
      if (req.backend !== "keychain") {
        return { ok: false, code: "invalid_argument", reason: "keychain port only accepts backend=keychain" }
      }
      if (!backend.available()) {
        return { ok: false, code: "unavailable", reason: "os keychain unavailable" }
      }
      const nameErr = assertSecretName(req.name)
      if (nameErr) return { ok: false, code: nameErr.code, reason: nameErr.reason }
      if (!req.plaintext) {
        return { ok: false, code: "invalid_argument", reason: "plaintext required" }
      }
      if (new TextEncoder().encode(req.plaintext).byteLength > MAX_SECRET_MATERIAL_BYTES) {
        return { ok: false, code: "invalid_argument", reason: "secret material too large" }
      }

      // Retry loop: each attempt allocates a unique account (nonce) — H1
      for (let attempt = 0; attempt < 8; attempt++) {
        const { payload, version } = await loadMeta()
        const prev = payload.secrets[req.name]
        const nextVersion = (prev?.currentVersion ?? 0) + 1
        // Unique account per write attempt — concurrent writers never share an item
        const account = allocateKeychainAccount({
          projectKey,
          name: req.name,
          version: nextVersion,
        })

        try {
          await backend.put({
            service: KEYCHAIN_SERVICE,
            account,
            secret: req.plaintext,
          })
        } catch {
          return { ok: false, code: "secret_backend", reason: "keychain put failed" }
        }

        const nextSecrets: Record<string, SecretMetaEntry> = {
          ...payload.secrets,
          [req.name]: { currentVersion: nextVersion, account },
        }
        const cas = await casMeta(version, { secrets: nextSecrets })
        if (cas.ok) {
          // Previous version cleanup (orphan recovery strategy: drop prior account only)
          if (prev?.account && prev.account !== account) {
            await deleteOrphan(prev.account)
          }
          return {
            ok: true,
            value: { backend: "keychain", name: req.name, version: nextVersion },
          }
        }

        // Loser: delete ONLY this attempt's unique orphan — winner item untouched
        await deleteOrphan(account)
        if (cas.code === "unavailable") return cas
        // conflict → retry with new nonce/version
      }
      return { ok: false, code: "secret_backend", reason: "secret metadata CAS retries exhausted" }
    },

    async getRef(req) {
      if (req.backend !== "keychain") {
        return { ok: false, code: "invalid_argument", reason: "keychain port only accepts backend=keychain" }
      }
      if (!backend.available()) {
        return { ok: false, code: "unavailable", reason: "os keychain unavailable" }
      }
      const { payload } = await loadMeta()
      const meta = payload.secrets[req.name]
      if (!meta) return { ok: false, code: "unavailable", reason: "secret not found" }
      // M2: attributes-only existence — never load material
      try {
        const ok = await backend.exists({ service: KEYCHAIN_SERVICE, account: meta.account })
        if (!ok) return { ok: false, code: "unavailable", reason: "secret not found" }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "keychain exists failed"
        if (msg.includes("authentication failed")) {
          return { ok: false, code: "unavailable", reason: "keychain authentication failed" }
        }
        return { ok: false, code: "secret_backend", reason: "keychain exists failed" }
      }
      return {
        ok: true,
        value: { backend: "keychain", name: req.name, version: meta.currentVersion },
      }
    },

    async resolveMaterial(ref) {
      if (ref.backend !== "keychain") {
        return { ok: false, code: "invalid_argument", reason: "expected keychain ref" }
      }
      if (!backend.available()) {
        return { ok: false, code: "unavailable", reason: "os keychain unavailable" }
      }
      const { payload } = await loadMeta()
      const meta = payload.secrets[ref.name]
      if (!meta || meta.currentVersion !== ref.version) {
        return { ok: false, code: "unavailable", reason: "secret ref not found" }
      }
      // Public path: confirm exists without returning material
      try {
        const ok = await backend.exists({ service: KEYCHAIN_SERVICE, account: meta.account })
        if (!ok) return { ok: false, code: "unavailable", reason: "secret ref not found" }
      } catch {
        return { ok: false, code: "secret_backend", reason: "keychain exists failed" }
      }
      return { ok: true, value: "__redacted__" }
    },

    async rotate(req) {
      return this.put(req)
    },
  }

  if (input.exposeInternalMaterial) {
    port.resolveSecretMaterial = async (ref) => {
      const { payload } = await loadMeta()
      const meta = payload.secrets[ref.name]
      if (!meta || meta.currentVersion !== ref.version) return null
      // Internal only — loads bytes then caller should zeroize
      return backend.get({ service: KEYCHAIN_SERVICE, account: meta.account })
    }
    port.readMeta = async () => (await loadMeta()).payload
  }

  return port
}

/**
 * Test-only map fallback — NOT used on live composition paths.
 */
export function createKeychainSecretPortWithMap(
  backend: KeychainBackend,
  options?: { exposeInternal?: boolean; projectKey?: string },
): SecretPort & { resolveSecretMaterial?: (ref: SecretRef) => Promise<string | null> } {
  const versions = new Map<string, { currentVersion: number; account: string }>()
  const projectKey = options?.projectKey ?? "project"
  const port: SecretPort & { resolveSecretMaterial?: (ref: SecretRef) => Promise<string | null> } = {
    async put(req) {
      if (req.backend !== "keychain") {
        return { ok: false, code: "invalid_argument", reason: "keychain port only accepts backend=keychain" }
      }
      if (!backend.available()) {
        return { ok: false, code: "unavailable", reason: "os keychain unavailable" }
      }
      const nameErr = assertSecretName(req.name)
      if (nameErr) return { ok: false, code: nameErr.code, reason: nameErr.reason }
      if (!req.plaintext) return { ok: false, code: "invalid_argument", reason: "plaintext required" }
      const prev = versions.get(req.name)
      const nextVersion = (prev?.currentVersion ?? 0) + 1
      const account = allocateKeychainAccount({ projectKey, name: req.name, version: nextVersion })
      try {
        await backend.put({ service: KEYCHAIN_SERVICE, account, secret: req.plaintext })
      } catch {
        return { ok: false, code: "secret_backend", reason: "keychain put failed" }
      }
      versions.set(req.name, { currentVersion: nextVersion, account })
      if (prev?.account) {
        try {
          await backend.remove({ service: KEYCHAIN_SERVICE, account: prev.account })
        } catch {
          // ignore
        }
      }
      return { ok: true, value: { backend: "keychain", name: req.name, version: nextVersion } }
    },
    async getRef(req) {
      if (!backend.available()) return { ok: false, code: "unavailable", reason: "os keychain unavailable" }
      const meta = versions.get(req.name)
      if (!meta) return { ok: false, code: "unavailable", reason: "secret not found" }
      const ok = await backend.exists({ service: KEYCHAIN_SERVICE, account: meta.account })
      if (!ok) return { ok: false, code: "unavailable", reason: "secret not found" }
      return { ok: true, value: { backend: "keychain", name: req.name, version: meta.currentVersion } }
    },
    async resolveMaterial(ref) {
      if (!backend.available()) return { ok: false, code: "unavailable", reason: "os keychain unavailable" }
      const meta = versions.get(ref.name)
      if (!meta || meta.currentVersion !== ref.version) {
        return { ok: false, code: "unavailable", reason: "secret ref not found" }
      }
      const ok = await backend.exists({ service: KEYCHAIN_SERVICE, account: meta.account })
      if (!ok) return { ok: false, code: "unavailable", reason: "secret ref not found" }
      return { ok: true, value: "__redacted__" }
    },
    async rotate(req) {
      return this.put(req)
    },
  }
  if (options?.exposeInternal) {
    port.resolveSecretMaterial = async (ref) => {
      const meta = versions.get(ref.name)
      if (!meta || meta.currentVersion !== ref.version) return null
      return backend.get({ service: KEYCHAIN_SERVICE, account: meta.account })
    }
  }
  return port
}

export * as SecretKeychain from "./secret-keychain"
