/**
 * Feature 006 / T032 (S21) — credential resolver acceptance.
 *
 * A secret is resolved only through a ref, rotate-secret keeps binding identity,
 * and no plaintext secret appears in any output (FR35, FR31, C19, AC30, AC35).
 */
import { describe, expect, test } from "bun:test"
import { CredentialResolver } from "@/semantic/credential-resolver"

const keychainRef = { backend: "keychain" as const, name: "milvus-token", version: 1 }
const envRef = { backend: "env-ref" as const, name: "MILVUS_TOKEN", version: 1 }
const identity = { providerProfileId: "prov-1", modelDescriptorId: "model-1", bindingId: "bind-1" }

describe("resolvePolicy", () => {
  test("keychain is always allowed", () => {
    expect(CredentialResolver.resolvePolicy(keychainRef, { ci: false }).ok).toBe(true)
  })
  test("env-ref is CI-only", () => {
    expect(CredentialResolver.resolvePolicy(envRef, { ci: false })).toEqual({ ok: false, reason: "env_ref_requires_ci" })
    expect(CredentialResolver.resolvePolicy(envRef, { ci: true }).ok).toBe(true)
  })
  test("an ill-formed ref is rejected", () => {
    expect(CredentialResolver.resolvePolicy({ token: "sk-plaintext" }, { ci: true })).toEqual({ ok: false, reason: "invalid_ref" })
  })
})

describe("asHandle", () => {
  test("carries only the ref coordinates, never plaintext", () => {
    const handle = CredentialResolver.asHandle(keychainRef)
    expect(handle.backend).toBe("keychain")
    expect(CredentialResolver.containsPlaintextSecret(handle)).toBe(false)
  })
})

describe("SecretResolvePort proxy", () => {
  test("applies the secret inside use without returning it to the resolver", async () => {
    let seen: string | undefined
    const port: CredentialResolver.SecretResolvePort = {
      withSecret: async (_ref, use) => use("Bearer resolved-token"),
    }
    const result = await port.withSecret(keychainRef, async (auth) => {
      seen = auth
      return "request-sent"
    })
    expect(result).toBe("request-sent")
    expect(seen).toBe("Bearer resolved-token")
  })
})

describe("rotateSecret", () => {
  test("changes only the secret ref, keeps binding identity", () => {
    const newRef = { backend: "keychain" as const, name: "milvus-token", version: 2 }
    const result = CredentialResolver.rotateSecret({ identity, currentRef: keychainRef, newRef })
    expect(result.identity).toEqual(identity)
    expect(result.ref.version).toBe(2)
    expect(result.changed).toBe("secret_ref_only")
  })

  test("the rotation audit is redacted (coordinates only, no secret)", () => {
    const newRef = { backend: "keychain" as const, name: "milvus-token", version: 2 }
    const audit = CredentialResolver.auditRotation({ identity, currentRef: keychainRef, newRef })
    expect(audit).toEqual({ bindingId: "bind-1", ref: newRef, fromVersion: 1, toVersion: 2 })
    expect(CredentialResolver.containsPlaintextSecret(audit)).toBe(false)
  })
})

describe("containsPlaintextSecret", () => {
  test("flags a raw secret in output but allows a bare SecretRef", () => {
    expect(CredentialResolver.containsPlaintextSecret({ apiKey: "sk-live-123456" })).toBe(true)
    expect(CredentialResolver.containsPlaintextSecret({ secret_ref: keychainRef })).toBe(false)
  })
})
