/**
 * Secret references + plaintext scanner (Feature 007 / T018, T021 review fix).
 * SecretRef must match exact schema (no extra keys). Scanner is recursive, cycle-safe, depth/size bounded.
 */
import { Option, Schema } from "effect"

export const SecretBackend = Schema.Literals(["keychain", "env-ref"]).annotate({
  identifier: "Operator.SecretBackend",
})
export type SecretBackend = typeof SecretBackend.Type

export const SecretRef = Schema.Struct({
  backend: SecretBackend,
  name: Schema.String.check(Schema.isPattern(/^\S+$/)),
  version: Schema.Number.check(Schema.isGreaterThanOrEqualTo(1)),
}).annotate({ identifier: "Operator.SecretRef" })
export type SecretRef = typeof SecretRef.Type

const decodeRef = Schema.decodeUnknownOption(SecretRef)

export type ParseOk<T> = { readonly ok: true; readonly value: T }
export type ParseFail = { readonly ok: false; readonly reason: string }
export type ParseResult<T> = ParseOk<T> | ParseFail

export function parseSecretRef(input: unknown): ParseResult<SecretRef> {
  if (!isExactSecretRef(input)) {
    return { ok: false, reason: "invalid secret ref" }
  }
  const decoded = decodeRef(input)
  if (Option.isNone(decoded)) {
    return { ok: false, reason: "invalid secret ref" }
  }
  return { ok: true, value: decoded.value }
}

/** Exact SecretRef: only backend/name/version keys, correct types. */
export function isExactSecretRef(input: unknown): input is SecretRef {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false
  const keys = Object.keys(input as object)
  if (keys.length !== 3) return false
  if (!keys.includes("backend") || !keys.includes("name") || !keys.includes("version")) return false
  const r = input as Record<string, unknown>
  if (r.backend !== "keychain" && r.backend !== "env-ref") return false
  if (typeof r.name !== "string" || !/^\S+$/.test(r.name)) return false
  if (typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1) return false
  return true
}

export const SECRET_FIELD_NAMES = [
  "password",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "clientSecret",
  "client_secret",
  "authorization",
  "privateKey",
  "private_key",
  "credential",
  "credentials",
  "passwd",
  "passphrase",
  "authToken",
  "auth_token",
  "bearer",
  "sessionToken",
  "session_token",
  "idToken",
  "id_token",
  "secretKey",
  "secret_key",
  "encryptionKey",
  "encryption_key",
] as const

const SECRET_FIELD_SET = new Set<string>(SECRET_FIELD_NAMES.map((n) => n.toLowerCase()))

export function isSecretFieldName(name: string): boolean {
  const lower = name.toLowerCase()
  if (SECRET_FIELD_SET.has(lower)) return true
  // broader aliases
  if (lower.endsWith("_secret") || lower.endsWith("_token") || lower.endsWith("_password")) return true
  if (lower.includes("apikey") || lower.includes("api_key")) return true
  return false
}

export type PlaintextScanOptions = {
  readonly maxDepth?: number
  readonly maxNodes?: number
}

const DEFAULT_MAX_DEPTH = 12
const DEFAULT_MAX_NODES = 2000

/**
 * Detect plaintext secrets. Exact SecretRef objects are allowed (no extra keys).
 * Cycle-safe and depth/size bounded.
 */
export function findPlaintextSecretFields(
  payload: unknown,
  path: string = "",
  options?: PlaintextScanOptions,
): string[] {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxNodes = options?.maxNodes ?? DEFAULT_MAX_NODES
  const seen = new WeakSet<object>()
  const hits: string[] = []
  let nodes = 0

  function walk(value: unknown, p: string, depth: number): void {
    if (hits.length > 50) return
    if (depth > maxDepth) {
      hits.push(p ? `${p}.__max_depth__` : "__max_depth__")
      return
    }
    if (++nodes > maxNodes) {
      hits.push("__max_nodes__")
      return
    }
    if (value === null || value === undefined) return
    if (typeof value !== "object") return

    if (seen.has(value as object)) return
    seen.add(value as object)

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], `${p}[${i}]`, depth + 1)
      }
      return
    }

    // Exact SecretRef allowed — do not recurse into it
    if (isExactSecretRef(value)) return

    // Object that looks like SecretRef but has extra keys / wrong shape → hit if secret-ish
    const record = value as Record<string, unknown>
    if ("backend" in record && ("name" in record || "version" in record) && !isExactSecretRef(value)) {
      hits.push(p || "(root)")
      return
    }

    for (const [key, child] of Object.entries(record)) {
      const next = p ? `${p}.${key}` : key
      if (isSecretFieldName(key)) {
        if (isExactSecretRef(child)) continue
        if (typeof child === "string" && child.length > 0) {
          hits.push(next)
          continue
        }
        // nested object under secret field that is not exact SecretRef
        if (child !== null && typeof child === "object") {
          hits.push(next)
          continue
        }
      }
      walk(child, next, depth + 1)
    }
  }

  walk(payload, path, 0)
  return hits
}

export * as OperatorSecret from "./secret"
